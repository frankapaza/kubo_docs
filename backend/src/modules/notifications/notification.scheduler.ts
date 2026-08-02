import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { TicketEvent } from '../tickets/entities/ticket-event.entity';
import { TicketEventsRepository } from '../tickets/ticket-events.repository';

import { NotificationDispatcher, NotificationDispatchError } from './notification-dispatcher.service';

/**
 * Cuántas filas se piden por pasada.
 *
 * Solo llegan aquí las que ya están vencidas: la espera se filtra en el `WHERE`
 * de la consulta, así que una fila que aguarda su reintento no gasta sitio del
 * lote ni puede tapar a las recién llegadas.
 */
export const NOTIFY_BATCH_SIZE = 100;

/**
 * Intentos de despacho por evento, contando el primero. Deliberadamente pocos.
 *
 * El reintento es **a nivel de evento**, no de aviso: un evento que manda dos
 * correos y falla en el segundo repite también el primero (ver la cabecera de
 * `NotificationDispatcher`). Cada intento extra es, en ese caso, un correo
 * duplicado para alguien que ya lo recibió. Tres intentos repartidos en
 * veinticinco minutos cubren el fallo típico —el SMTP que no responde un
 * rato— sin convertir un rebote permanente en cuatro copias del mismo correo.
 */
export const NOTIFY_MAX_ATTEMPTS = 3;

/**
 * La espera hasta el siguiente intento, indexada por **intentos ya gastados**:
 * cinco minutos tras el primer fallo, veinte tras el segundo. Tras el tercero
 * no hay siguiente, se abandona.
 *
 * Se guarda como instante absoluto en `ticket_events.notify_next_attempt_at`
 * (migración 016) en el momento de fallar, así que la espera se mide desde el
 * intento **real**.
 *
 * La versión anterior no tenía esa columna y derivaba la espera de `created_at`
 * con retrasos acumulados. Era un error, y uno silencioso: solo frenaba
 * mientras la fila era joven. Un evento que se miraba por primera vez con más
 * edad que el retraso mayor cumplía todos los retrasos a la vez, gastaba los
 * tres intentos en tres pasadas seguidas y quedaba abandonado en unos tres
 * minutos. Ocurría justo en el escenario para el que existen los reintentos:
 * al volver el SMTP de una caída larga, con la cola ya envejecida.
 */
export const NOTIFY_RETRY_DELAYS_MS = [5 * 60_000, 20 * 60_000];

/**
 * Fallos seguidos al **escribir** el resultado de un evento antes de dejar de
 * despacharlo.
 *
 * Es la protección de un camino que el tope de intentos no cubre: si el
 * despacho sale bien pero el `UPDATE` que lo sella falla, la fila sigue
 * pendiente y `notify_attempts` **no avanza** —vive en la fila que no se puede
 * escribir—. Sin este freno, la pasada siguiente vuelve a despachar, los
 * correos salen otra vez, vuelve a fallar el `UPDATE`, y así cada sesenta
 * segundos indefinidamente.
 *
 * El contador vive en memoria del proceso por necesidad, no por comodidad: si
 * la base no acepta el `UPDATE`, tampoco va a aceptar que guardemos el
 * contador. Se reinicia al reiniciar el backend, que es lo correcto: un
 * reinicio es también la ocasión de volver a probar.
 */
export const NOTIFY_MAX_WRITE_FAILURES = 3;

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

/**
 * Con qué empieza el texto que se graba al abandonar un evento.
 *
 * Se comprueba antes de volver a componerlo: envolver otra vez un texto ya
 * envuelto acabaría empujando el error original fuera de los 500 caracteres, y
 * el motivo de un aviso perdido es justo lo último que puede desaparecer por
 * un problema de formato.
 *
 * El caso que lo provoca es que una fila ya abandonada vuelva a la cola con su
 * texto dentro: alguien le quita el sellado para reintentar el aviso, que es
 * justo a lo que invita el log del abandono. **No** es un sellado que falla —
 * un `UPDATE` que falla no escribe nada, así que no puede dejar el prefijo en
 * ninguna parte.
 */
const ABANDONED_PREFIX = 'Agotados los';

/** Lo que hizo una pasada del vigilante. */
export interface DrainSummary {
  /**
   * Filas cuyo destino quedó **escrito** en esta pasada: selladas o marcadas
   * para reintento. No cuenta las que ni se miraron (esperando su turno o
   * bloqueadas) ni aquellas cuyo `UPDATE` falló.
   */
  processed: number;
  /**
   * Correos que salieron, no eventos: un evento puede mandar dos. Se cuentan
   * aunque después falle el sellado — salieron igual, y ese es el dato que
   * hace falta para entender un duplicado. Y por lo mismo se cuentan también
   * los del **envío parcial**, leídos de `NotificationDispatchError.sentEntries`:
   * es justo el caso en que el dato importa, porque el reintento del evento
   * entero los va a repetir.
   */
  sent: number;
  /** Eventos cuyo despacho falló en esta pasada. Incluye el que agota el tope. */
  failed: number;
  /**
   * Eventos que se dan por perdidos: agotaron los intentos y quedan sellados
   * sin haberse notificado. Es el contador que de verdad hay que vigilar, y por
   * eso no se mezcla con `failed`: un fallo se reintenta, un abandono no.
   */
  abandoned: number;
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

/** La espera hasta el siguiente intento, dados los intentos ya gastados. */
export function retryDelayMs(spentAttempts: number): number {
  const index = Math.min(Math.max(spentAttempts, 1), NOTIFY_RETRY_DELAYS_MS.length) - 1;
  return NOTIFY_RETRY_DELAYS_MS[index];
}

/** Un contador de intentos utilizable, venga como venga de la base. */
function attemptsOf(event: TicketEvent): number {
  const n = Number(event.notifyAttempts);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Lo que hizo `recordFailure`, para que `drain` sepa qué contar. */
interface FailureOutcome {
  /** Si el resultado quedó escrito en la base. */
  written: boolean;
  /** Si con esto el evento se da por perdido. */
  abandoned: boolean;
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
 * ## Las cuatro reglas que mantienen la cola sana
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
 * 3. **La espera se mide desde el intento real**, guardada como instante en
 *    `notify_next_attempt_at`, y se filtra en el `WHERE`. Ver
 *    `NOTIFY_RETRY_DELAYS_MS` para lo que pasaba cuando se derivaba de
 *    `created_at`.
 * 4. **Nada de esto ocurre dentro de una transacción.** Ni el envío ni el
 *    sellado: un correo mandado dentro de una transacción que luego se deshace
 *    es una mentira que ya no se puede retirar. Cada fila se escribe con su
 *    propio `UPDATE`, después de que el envío haya terminado.
 *
 * ## Una sola pasada a la vez
 *
 * `@nestjs/schedule` no espera a que el callback anterior termine —
 * `waitForCompletion` vale `false` por omisión—, y una pasada pasa de sesenta
 * segundos con facilidad: el lote es de cien, los envíos son secuenciales y
 * `EmailService.send` abre un transporter nuevo por correo (handshake, TLS y
 * AUTH cada vez). Con el SMTP lento, la pasada siguiente entraría con la
 * primera todavía dentro del envío y sin haber sellado ninguna fila: la
 * consulta le devolvería exactamente las mismas y las despacharía otra vez.
 * Ese duplicado no es ninguno de los aceptados —no viene con un fallo
 * registrado detrás, ni hace falta una segunda réplica—: lo produce el camino
 * feliz. Y, de paso, las dos pasadas leerían `notify_attempts = 0` y las dos
 * escribirían `1`, falseando el presupuesto de reintentos justo cuando el SMTP
 * va mal. Ver `handleCron` y `running`.
 *
 * ## Sobre el "exactamente una vez"
 *
 * No lo hay, y no se pretende. Si el proceso muere entre el envío y el sellado,
 * el correo saldrá dos veces. La alternativa —sellar antes de enviar— cambia
 * un correo repetido por un correo perdido en silencio, que es peor. Lo que sí
 * se acota es que ese duplicado no se repita para siempre: ver
 * `NOTIFY_MAX_WRITE_FAILURES`. Y con dos réplicas del backend tampoco lo hay:
 * el freno de `running` vive en memoria del proceso y no coordina nada entre
 * instancias — es un compromiso aceptado, distinto del solapamiento de una
 * sola instancia, que sí se cierra aquí.
 */
@Injectable()
export class NotificationScheduler {
  private readonly logger = new Logger(NotificationScheduler.name);

  /**
   * Fallos seguidos de escritura por evento, y los que ya han superado el tope.
   *
   * En memoria del proceso a propósito y sin más remedio: son precisamente los
   * eventos cuyo resultado la base no acepta guardar. Se limpian en cuanto una
   * escritura suya sale bien.
   */
  private readonly writeFailures = new Map<string, number>();
  private readonly blocked = new Set<string>();

  /**
   * Desde cuándo hay una pasada en vuelo, o `null` si no la hay.
   *
   * El `@Cron` ya lleva `waitForCompletion: true`, que se lo pide a la
   * librería. Este campo no lo duplica: lo complementa con lo que la opción no
   * da, que es **el rastro**. Una pasada que se salta por solaparse tiene que
   * distinguirse de un minuto sin trabajo, y lo que hay que poder leer el día
   * en que alguien pregunte por qué un aviso tardó un cuarto de hora es cuánto
   * lleva atascada la que sigue dentro. Guardar el instante y no un booleano
   * es justo eso: el aviso dice desde cuándo.
   *
   * Además, no depende de un detalle de la librería. `waitForCompletion` es
   * una opción del decorador: basta con que alguien reordene el `@Cron`, lo
   * copie a otro vigilante o cambie de versión para perderla en silencio, y lo
   * que se pierde es que no salgan correos repetidos.
   */
  private runningSince: Date | null = null;

  constructor(
    private readonly events: TicketEventsRepository,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  /**
   * Cada minuto. Es el retraso máximo que un aviso puede acumular por estar en
   * cola, y el precio de no acoplar los nueve puntos donde se escriben eventos
   * al envío de correo.
   *
   * `waitForCompletion: true` porque el valor por omisión es `false`: sin él,
   * la librería dispara la pasada siguiente aunque esta siga dentro del envío
   * (ver la sección "Una sola pasada a la vez" en la cabecera de la clase). El
   * freno propio de `runningSince` va además de la opción, no en su lugar.
   */
  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async handleCron(): Promise<void> {
    const inicio = new Date();

    // La comprobación y la marca, las dos antes del primer `await`: entre
    // ellas no puede colarse otra pasada.
    if (this.runningSince !== null) {
      const segundos = Math.round((inicio.getTime() - this.runningSince.getTime()) / 1_000);
      this.logger.warn(
        `La pasada anterior del drenaje de avisos sigue en curso desde hace ${segundos}s ` +
          '(empezó a las ' + this.runningSince.toISOString() + '): esta se salta. ' +
          'Entrar ahora releería las mismas filas —todavía sin sellar— y volvería a mandar ' +
          'sus correos. Si se repite, el envío va más lento que el reloj: mira el SMTP.',
      );
      return;
    }
    this.runningSince = inicio;

    try {
      const { processed, sent, failed, abandoned } = await this.drain(inicio);

      if (processed > 0) {
        const linea =
          `Avisos: ${processed} evento(s) procesados, ${sent} correo(s) enviados, ` +
          `${failed} fallo(s), ${abandoned} abandonado(s).`;
        // Un abandono es un aviso que no va a llegar nunca. No puede quedarse
        // en un `log` entre el ruido de las pasadas que no hacen nada.
        if (abandoned > 0) this.logger.error(linea);
        else this.logger.log(linea);
      }

      // Se repite cada pasada mientras dure, y debe repetirse: significa que
      // hay avisos parados y que hace falta una intervención manual.
      if (this.blocked.size > 0) {
        this.logger.error(
          `${this.blocked.size} evento(s) bloqueados por fallos de escritura: no se despachan ` +
            'para no reenviar los mismos correos cada minuto. Arregla la escritura en ' +
            'ticket_events y reinicia el backend.',
        );
      }
    } catch (error) {
      // Se traga aquí y solo aquí: si escapara, `@nestjs/schedule` lo
      // convertiría en un rechazo sin capturar y el proceso podría caerse,
      // dejando de mandar avisos por un fallo puntual de una consulta.
      this.logger.error(`Falló el drenaje de la bandeja de avisos: ${errorText(error)}`);
    } finally {
      // En `finally` y no al final del `try`: una pasada que reviente no puede
      // dejar el freno echado para siempre y apagar el vigilante entero.
      this.runningSince = null;
    }
  }

  async drain(now: Date = new Date()): Promise<DrainSummary> {
    const pending = await this.events.listPendingNotification(NOTIFY_BATCH_SIZE, now);
    const summary: DrainSummary = { processed: 0, sent: 0, failed: 0, abandoned: 0 };

    for (const event of pending) {
      // Un evento cuyo resultado no se puede escribir no se vuelve a despachar:
      // cada pasada reenviaría sus correos sin que el contador avanzase nunca.
      // Ya se gritó en el log al bloquearlo, y se repite en cada pasada.
      if (this.blocked.has(String(event.id))) continue;

      const attempts = attemptsOf(event);

      // Una fila que llega con el tope ya gastado (la dejó así una caída entre
      // el envío y el `UPDATE`, o una bajada del tope) no vuelve a intentarse.
      if (attempts >= NOTIFY_MAX_ATTEMPTS) {
        summary.abandoned += 1;
        this.logAbandoned(event, attempts, event.notifyLastError);
        if (await this.seal(event, now, attempts, this.exhaustedText(event.notifyLastError))) {
          summary.processed += 1;
        }
        continue;
      }

      // Cada evento va en su propio `try`: un fallo suyo —del envío o del
      // `UPDATE`— no puede impedir que salgan los siguientes del lote.
      try {
        const result = await this.dispatcher.dispatchForEvent(event);
        // Antes del sellado: si el `UPDATE` falla, esos correos ya salieron y
        // el contador tiene que decirlo.
        summary.sent += result.sent;
        if (await this.seal(event, now, attempts, result.skipped)) summary.processed += 1;
      } catch (error) {
        summary.failed += 1;
        // Un despacho que falla puede haber entregado parte del plan: el alta
        // desde el portal escribe al autor y al buzón, y el primero puede
        // salir antes de que reviente el segundo. `sent` cuenta correos, no
        // eventos con éxito, así que esos cuentan igual — y el despachador se
        // molesta en enumerarlos en `sentEntries` justo para esto. Sin leerlo,
        // el resumen diría que no salió nada el mismo minuto en que a un
        // cliente le llegó el suyo, que es el dato que hace falta el día que
        // pregunte por qué lo recibió dos veces.
        if (error instanceof NotificationDispatchError) {
          summary.sent += error.sentEntries.length;
        }
        const outcome = await this.recordFailure(event, now, attempts, error);
        if (outcome.written) summary.processed += 1;
        if (outcome.abandoned) summary.abandoned += 1;
      }
    }

    return summary;
  }

  /**
   * Sella la fila. Devuelve si el `UPDATE` salió: un fallo al escribir se
   * registra y se sigue con el lote.
   */
  private async seal(
    event: TicketEvent,
    now: Date,
    attempts: number,
    reason: string | null,
  ): Promise<boolean> {
    try {
      await this.events.markNotified(event.id, now, attempts, truncateNotifyError(reason));
      this.noteWriteOk(event);
      return true;
    } catch (error) {
      this.noteWriteFailure(event, error);
      return false;
    }
  }

  /**
   * Anota el intento fallido y cuándo toca el siguiente. Si era el último,
   * **sella igualmente** y deja el error grabado: reintentar para siempre no
   * arregla un rebote permanente y clava la fila en la cabeza de la cola.
   */
  private async recordFailure(
    event: TicketEvent,
    now: Date,
    attempts: number,
    error: unknown,
  ): Promise<FailureOutcome> {
    const spent = attempts + 1;
    const message = errorText(error);

    if (spent >= NOTIFY_MAX_ATTEMPTS) {
      this.logAbandoned(event, spent, message);
      return {
        written: await this.seal(event, now, spent, this.exhaustedText(message)),
        abandoned: true,
      };
    }

    const nextAttemptAt = new Date(now.getTime() + retryDelayMs(spent));
    this.logger.warn(
      `Intento ${spent}/${NOTIFY_MAX_ATTEMPTS} fallido para el evento ${String(event.id)} ` +
        `(ticket ${String(event.ticketId)}): ${message}. ` +
        `Se reintenta a partir de ${nextAttemptAt.toISOString()}.`,
    );

    try {
      await this.events.recordNotifyFailure(
        event.id,
        spent,
        nextAttemptAt,
        truncateNotifyError(message),
      );
      this.noteWriteOk(event);
      return { written: true, abandoned: false };
    } catch (updateError) {
      this.noteWriteFailure(event, updateError);
      return { written: false, abandoned: false };
    }
  }

  /** Una escritura que sale bien limpia el historial de fallos del evento. */
  private noteWriteOk(event: TicketEvent): void {
    this.writeFailures.delete(String(event.id));
  }

  /**
   * Un fallo al escribir el resultado. Tras `NOTIFY_MAX_WRITE_FAILURES`
   * seguidos, el evento deja de despacharse: sin poder anotar el resultado,
   * cada pasada reenviaría los mismos correos y el tope de intentos no lo
   * frenaría, porque su contador vive en la fila que no se puede escribir.
   */
  private noteWriteFailure(event: TicketEvent, error: unknown): void {
    const key = String(event.id);
    const count = (this.writeFailures.get(key) ?? 0) + 1;
    this.writeFailures.set(key, count);

    if (count >= NOTIFY_MAX_WRITE_FAILURES) {
      this.blocked.add(key);
      this.logger.error(
        `El evento ${key} (ticket ${String(event.ticketId)}) queda BLOQUEADO: ${count} intentos ` +
          `de registrar su resultado han fallado, el último con "${errorText(error)}". La fila ` +
          'sigue pendiente en la base, pero no se volverá a despachar mientras viva este ' +
          'proceso: sin poder anotar el resultado, cada pasada reenviaría los mismos correos ' +
          'cada minuto y el tope de intentos no lo frenaría. Arregla la escritura en ' +
          'ticket_events y reinicia el backend.',
      );
      return;
    }

    this.logger.error(
      `No se pudo registrar el resultado del evento ${key} ` +
        `(fallo ${count}/${NOTIFY_MAX_WRITE_FAILURES}): ${errorText(error)}. ` +
        'Sus avisos pueden repetirse en la pasada siguiente.',
    );
  }

  /** Un aviso que ya no va a llegar. Nunca en silencio. */
  private logAbandoned(event: TicketEvent, attempts: number, lastError: string | null): void {
    this.logger.error(
      `Se abandona el aviso del evento ${String(event.id)} (ticket ${String(event.ticketId)}, ` +
        `tipo ${String(event.type)}) tras ${attempts} intento(s): ${lastError ?? 'sin detalle'}. ` +
        'Queda sellado y NO se reintenta; si el aviso importaba, hay que rehacerlo a mano.',
    );
  }

  /**
   * El texto que queda grabado cuando se abandona un evento. Dice cuántos
   * intentos se gastaron además del último error, porque leyendo solo el error
   * no se distingue "falló una vez" de "se rindió".
   *
   * Idempotente: si el texto que llega ya es uno de estos —la fila volvió a la
   * cola con el rastro de un abandono anterior—, se devuelve tal cual. Volver a
   * envolverlo anidaría el prefijo en cada vuelta hasta empujar el error
   * original fuera de los 500 caracteres.
   */
  private exhaustedText(lastError: string | null): string {
    if (lastError !== null && lastError.trimStart().startsWith(ABANDONED_PREFIX)) return lastError;
    return (
      `${ABANDONED_PREFIX} ${NOTIFY_MAX_ATTEMPTS} intentos de envío; no se reintenta más. ` +
      `Último error: ${lastError ?? 'sin detalle'}`
    );
  }
}
