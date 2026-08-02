import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { TicketEvent } from '../tickets/entities/ticket-event.entity';
import { TicketEventsRepository } from '../tickets/ticket-events.repository';

import { NotificationDispatcher } from './notification-dispatcher.service';

/**
 * Cuántas filas pendientes se miran por pasada.
 *
 * Generoso a propósito. El vigilante descarta en memoria las que todavía están
 * esperando su reintento, y esas gastan sitio del lote: con un lote pequeño,
 * un puñado de eventos en espera podría tapar a los recién llegados. Con cien,
 * eso solo pasaría si fallaran cien a la vez —es decir, con el SMTP caído—, y
 * entonces tampoco habría nada que mandar.
 */
export const NOTIFY_BATCH_SIZE = 100;

/**
 * Intentos de despacho por evento, contando el primero. Deliberadamente pocos.
 *
 * El reintento es **a nivel de evento**, no de aviso: un evento que manda dos
 * correos y falla en el segundo repite también el primero (ver la cabecera de
 * `NotificationDispatcher`). Cada intento extra es, en ese caso, un correo
 * duplicado para alguien que ya lo recibió. Tres intentos repartidos en veinte
 * minutos cubren el fallo típico —el SMTP que no responde un rato— sin
 * convertir un rebote permanente en cuatro copias del mismo correo.
 */
export const NOTIFY_MAX_ATTEMPTS = 3;

/**
 * La espera exigida antes de cada intento, indexada por `notify_attempts`.
 *
 * ## De dónde sale el instante de referencia
 *
 * No hay columna con la fecha del último intento, y no hacía falta crear una:
 * la espera se mide desde `created_at`, que ya existe, es inmutable y es
 * exactamente el momento en que la fila entró en la cola. Con los retrasos
 * acumulados desde ahí, cada evento tiene un **calendario fijo** de intentos
 * (t0, t0+5min, t0+20min) en lugar de una cuenta atrás que se reinicia. Sale
 * lo mismo en la práctica —el primer intento ocurre en el minuto siguiente a
 * la creación—, es determinista, y no depende de una escritura que podría
 * fallar justo cuando el sistema está mal.
 *
 * La única diferencia frente a medir desde el último intento aparece si el
 * vigilante estuvo parado horas: al volver, los pendientes se reintentan de
 * golpe en vez de escalonarse. Es lo deseable — llevan horas de retraso.
 *
 * El primero es 0: un evento recién nacido se intenta en cuanto se ve.
 */
export const NOTIFY_RETRY_DELAYS_MS = [0, 5 * 60_000, 20 * 60_000];

/**
 * Ancho de `ticket_events.notify_last_error`.
 *
 * No es decorativo: MySQL corre en `STRICT_TRANS_TABLES`, así que pasarse **no
 * trunca, aborta**. Y lo que abortaría es justo el `UPDATE` que registra el
 * fallo, dejando la fila reintentando indefinidamente y sin ningún rastro del
 * motivo — el peor sitio posible para un error secundario. Por eso se recorta
 * aquí y no se confía en el ancho de la columna.
 */
export const NOTIFY_ERROR_MAX_LENGTH = 500;

/** Marca de que el texto venía recortado, en el presupuesto de los 500. */
const ELLIPSIS = '...';

/** Lo que hizo una pasada del vigilante. */
export interface DrainSummary {
  /**
   * Filas cuyo destino se resolvió en esta pasada: selladas o marcadas para
   * reintento. No cuenta las que se saltaron porque su espera no había
   * transcurrido, ni las que ya estaban selladas.
   */
  processed: number;
  /** Correos que salieron, no eventos: un evento puede mandar dos. */
  sent: number;
  /** Eventos cuyo despacho falló. */
  failed: number;
}

/**
 * El texto de un error, sin la pila.
 *
 * La pila nunca: acaba en una columna que se enseña en el panel, ocuparía ella
 * sola los 500 caracteres y no dice nada que el mensaje no diga ya. Un
 * `NotificationDispatchError` trae en su `message` qué avisos salieron y
 * cuáles no, que es lo que de verdad hace falta para entender un reintento.
 */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/**
 * El texto tal y como puede guardarse en `notify_last_error`: una sola línea y
 * dentro del ancho de la columna.
 *
 * Aplana los saltos de línea porque las respuestas de un SMTP vienen
 * multilínea (`550 ...\r\n mailbox unavailable`) y una columna de 500
 * caracteres con saltos dentro se lee mal en cualquier listado. Recorta por el
 * final: el motivo está al principio, el relleno viene después.
 */
export function truncateNotifyError(text: string | null): string | null {
  if (text === null) return null;
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length === 0) return null;
  if (oneLine.length <= NOTIFY_ERROR_MAX_LENGTH) return oneLine;
  return oneLine.slice(0, NOTIFY_ERROR_MAX_LENGTH - ELLIPSIS.length) + ELLIPSIS;
}

/** Un contador de intentos utilizable, venga como venga de la base. */
function attemptsOf(event: TicketEvent): number {
  const n = Number(event.notifyAttempts);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * El instante de `created_at` en milisegundos, o `null` si no se puede leer.
 *
 * `null` se trata más adelante como "intentable ya": una fila cuya fecha no se
 * entiende es un problema, pero dejarla atascada para siempre en la cabeza de
 * la cola es un problema mayor.
 */
function createdAtMs(event: TicketEvent): number | null {
  const value: unknown = event.createdAt;
  const date = value instanceof Date ? value : new Date(String(value));
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Drena la bandeja de salida: lee de `ticket_events` las filas confirmadas que
 * faltan por notificar, las pasa al despachador y anota lo que salió y lo que
 * no.
 *
 * Mismo patrón que `SlaRiskScheduler`: el `@Cron` no tiene lógica, solo llama a
 * `drain`, que recibe `now` por parámetro para poder probar la espera creciente
 * sin esperar de verdad.
 *
 * ## Las tres reglas que mantienen la cola sana
 *
 * 1. **Todo lo que se mira se sella, salvo si se va a reintentar.** Un evento
 *    que no genera ningún aviso se sella igual que uno que mandó dos correos.
 *    No es un caso raro: la mayoría de los tipos de evento no avisan a nadie,
 *    y si se quedaran pendientes la cola crecería sin fin y cada pasada
 *    rearrastraría las mismas filas para no hacer nada con ellas.
 * 2. **Agotar los intentos también sella.** Con el error grabado, para que
 *    alguien pueda mirarlo. Dejarla pendiente la clavaría en la cabeza del
 *    índice `(notified_at, id)` y el vigilante la releería en cada pasada
 *    hasta el fin de los tiempos.
 * 3. **Nada de esto ocurre dentro de una transacción.** Ni el envío ni el
 *    sellado: un correo mandado dentro de una transacción que luego se deshace
 *    es una mentira que ya no se puede retirar. Cada fila se escribe con su
 *    propio `UPDATE`, después de que el envío haya terminado.
 *
 * ## Sobre el "exactamente una vez"
 *
 * No lo hay, y no se pretende. Si el proceso muere entre el envío y el sellado,
 * el correo saldrá dos veces. La alternativa —sellar antes de enviar— cambia
 * un correo repetido por un correo perdido en silencio, que es peor.
 */
@Injectable()
export class NotificationScheduler {
  private readonly logger = new Logger(NotificationScheduler.name);

  constructor(
    private readonly events: TicketEventsRepository,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  /**
   * Cada minuto. Es el retraso máximo que un aviso puede acumular por estar en
   * cola, y el precio de no acoplar los nueve puntos donde se escriben eventos
   * al envío de correo.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    try {
      const { processed, sent, failed } = await this.drain(new Date());
      if (processed > 0) {
        this.logger.log(
          `Avisos: ${processed} evento(s) procesados, ${sent} correo(s) enviados, ${failed} fallo(s).`,
        );
      }
    } catch (error) {
      // Se traga aquí y solo aquí: si escapara, `@nestjs/schedule` lo
      // convertiría en un rechazo sin capturar y el proceso podría caerse,
      // dejando de mandar avisos por un fallo puntual de una consulta.
      this.logger.error(`Falló el drenaje de la bandeja de avisos: ${errorText(error)}`);
    }
  }

  async drain(now: Date = new Date()): Promise<DrainSummary> {
    const pending = await this.events.listPendingNotification(NOTIFY_BATCH_SIZE);
    const summary: DrainSummary = { processed: 0, sent: 0, failed: 0 };

    for (const event of pending) {
      const attempts = attemptsOf(event);

      // Una fila que llega con el tope ya gastado (la dejó así una caída entre
      // el envío y el `UPDATE`, o una bajada del tope) no vuelve a intentarse.
      if (attempts >= NOTIFY_MAX_ATTEMPTS) {
        if (await this.seal(event, now, attempts, this.exhaustedText(event.notifyLastError))) {
          summary.processed += 1;
        }
        continue;
      }

      if (!this.isDue(event, attempts, now)) continue;

      // Cada evento va en su propio `try`: un fallo suyo —del envío o del
      // `UPDATE`— no puede impedir que salgan los siguientes del lote.
      try {
        const result = await this.dispatcher.dispatchForEvent(event);
        if (await this.seal(event, now, attempts, result.skipped)) {
          summary.processed += 1;
          summary.sent += result.sent;
        }
      } catch (error) {
        summary.failed += 1;
        if (await this.recordFailure(event, now, attempts, error)) summary.processed += 1;
      }
    }

    return summary;
  }

  /**
   * ¿Le toca ya a este evento?
   *
   * Con `attempts = 0` siempre sí (el primer retraso es cero). Con más, hace
   * falta que haya pasado desde `created_at` la espera del intento
   * correspondiente — ver `NOTIFY_RETRY_DELAYS_MS` para por qué la referencia
   * es `created_at` y no una columna nueva.
   */
  private isDue(event: TicketEvent, attempts: number, now: Date): boolean {
    const delay = NOTIFY_RETRY_DELAYS_MS[Math.min(attempts, NOTIFY_RETRY_DELAYS_MS.length - 1)];
    if (delay === 0) return true;

    const created = createdAtMs(event);
    if (created === null) return true; // sin fecha legible, mejor intentarlo que atascarlo
    return now.getTime() - created >= delay;
  }

  /**
   * Sella la fila. Devuelve si el `UPDATE` salió: un fallo al escribir se
   * registra y se sigue con el lote, y la fila se reintentará en la pasada
   * siguiente porque sigue pendiente.
   */
  private async seal(
    event: TicketEvent,
    now: Date,
    attempts: number,
    reason: string | null,
  ): Promise<boolean> {
    try {
      await this.events.markNotified(event.id, now, attempts, truncateNotifyError(reason));
      return true;
    } catch (error) {
      this.logger.error(
        `No se pudo sellar el evento ${String(event.id)} como notificado: ${errorText(error)}. ` +
          'Se reintentará en la pasada siguiente, así que sus avisos pueden repetirse.',
      );
      return false;
    }
  }

  /**
   * Anota el intento fallido. Si era el último, **sella igualmente** y deja el
   * error grabado: reintentar para siempre no arregla un rebote permanente y
   * clava la fila en la cabeza de la cola.
   */
  private async recordFailure(
    event: TicketEvent,
    now: Date,
    attempts: number,
    error: unknown,
  ): Promise<boolean> {
    const spent = attempts + 1;
    const message = errorText(error);

    this.logger.warn(
      `Intento ${spent}/${NOTIFY_MAX_ATTEMPTS} fallido para el evento ${String(event.id)} ` +
        `(ticket ${String(event.ticketId)}): ${message}`,
    );

    if (spent >= NOTIFY_MAX_ATTEMPTS) {
      return this.seal(event, now, spent, this.exhaustedText(message));
    }

    try {
      await this.events.recordNotifyFailure(event.id, spent, truncateNotifyError(message));
      return true;
    } catch (updateError) {
      this.logger.error(
        `No se pudo registrar el fallo del evento ${String(event.id)}: ${errorText(updateError)}.`,
      );
      return false;
    }
  }

  /**
   * El texto que queda grabado cuando se abandona un evento. Dice cuántos
   * intentos se gastaron además del último error, porque leyendo solo el error
   * no se distingue "falló una vez" de "se rindió".
   */
  private exhaustedText(lastError: string | null): string {
    return (
      `Agotados los ${NOTIFY_MAX_ATTEMPTS} intentos de envío; no se reintenta más. ` +
      `Último error: ${lastError ?? 'sin detalle'}`
    );
  }
}
