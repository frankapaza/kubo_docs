import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { InboundEmailService } from './inbound-email.service';
import { WorkspaceService } from '../workspace/workspace.service';

/** El texto de un error, venga de donde venga. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * El reloj de la ingesta de correo: cada minuto, drena el buzón si el
 * interruptor de los ajustes del espacio de trabajo está encendido.
 *
 * **Mismo patrón que `NotificationScheduler`, y por el mismo motivo exacto.**
 * Ese vigilante tenía justamente el defecto que aquí se evita a propósito:
 * `@nestjs/schedule` no espera a que el callback anterior termine
 * (`waitForCompletion` vale `false` por omisión), así que si una pasada de
 * `drain()` tarda más de sesenta segundos -- un buzón lento, un lote grande,
 * el SMTP de un ticket nuevo yéndose despacio --, la pasada siguiente
 * entraría con el correo anterior todavía sin marcar y el buzón se lo
 * volvería a entregar. `InboundEmailsRepository` deduplica por Message-ID, así
 * que ese correo concreto no crearía un segundo ticket, pero sí procesaría dos
 * veces cada correo del lote sin necesidad, y gastaría el tope de tickets
 * nuevos y el de respuestas a desconocido dos veces por el mismo lote real.
 * `waitForCompletion: true` se lo pide a la librería; `runningSince` lo
 * complementa con lo que la opción no da -- el rastro de desde cuándo lleva
 * una pasada en vuelo, para poder distinguir "se saltó una pasada" de "no
 * había nada que hacer" en el log -- y no depende de que nadie recuerde
 * mantener la opción del decorador si este archivo se copia o se reordena.
 *
 * **El interruptor apagado no hace nada, y no se queja.** Es el estado de
 * salida de la ingesta (Task 8: nace apagada) y va a ser el normal durante
 * buena parte de la vida de este proyecto -- antes de que alguien la
 * encienda, y en cualquier despliegue que decida no usarla. Registrar un log
 * cada minuto por algo que es la configuración deliberada sería ruido, no
 * información. Por eso la comprobación del interruptor se hace **antes** de
 * llamar a `drain()`, y no dentro de él: con el interruptor apagado, este
 * archivo no debe intentar conectarse al buzón en absoluto -- ni siquiera
 * para descubrir que no hay nada que hacer.
 *
 * **Un buzón que no responde es silencio normal, no una alarma.** Si `drain()`
 * revienta (el servidor IMAP no contesta, la contraseña cambió, la red falla),
 * se anota en el log y se reintenta en la vuelta siguiente -- no hay ningún
 * canal de aviso a nadie en este proyecto, así que "no se avisa a nadie" es,
 * en la práctica, "no se escala más allá de esta línea del log".
 */
@Injectable()
export class InboundEmailScheduler {
  private readonly logger = new Logger(InboundEmailScheduler.name);

  /** Ver el comentario homónimo en `NotificationScheduler`: mismo porqué exacto. */
  private runningSince: Date | null = null;

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly inboundEmail: InboundEmailService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async handleCron(): Promise<void> {
    const inicio = new Date();

    // La comprobación y la marca, las dos antes del primer `await`: entre
    // ellas no puede colarse otra pasada.
    if (this.runningSince !== null) {
      const segundos = Math.round((inicio.getTime() - this.runningSince.getTime()) / 1_000);
      this.logger.warn(
        `La pasada anterior de la ingesta de correo sigue en curso desde hace ${segundos}s ` +
          `(empezó a las ${this.runningSince.toISOString()}): esta se salta. Entrar ahora ` +
          'releería correos que la pasada en curso todavía no ha marcado y los procesaría dos veces.',
      );
      return;
    }
    this.runningSince = inicio;

    try {
      const encendida = await this.workspace.isImapIngestionEnabled();
      if (!encendida) return; // Apagada: nada que hacer, y no hay que decirlo.

      const resumen = await this.inboundEmail.drain();
      if (resumen.fetched > 0) {
        this.logger.log(
          `Ingesta de correo: ${resumen.fetched} correo(s) leídos, ${resumen.ticketsCreated} ticket(s) ` +
            `creados, ${resumen.messagesAdded} mensaje(s) añadidos, ${resumen.discarded} descartado(s), ` +
            `${resumen.unknownSenders} de remitente desconocido, ${resumen.duplicates} duplicado(s), ` +
            `${resumen.errors} error(es).`,
        );
      }
    } catch (error) {
      // Un minuto de silencio es normal: el buzón no responde, la red falla,
      // o la contraseña acaba de cambiar. Se anota y se reintenta en la
      // próxima pasada -- no hay nada más que hacer aquí, y no escapar esta
      // excepción es lo que impide que `@nestjs/schedule` la convierta en un
      // rechazo sin capturar que podría tumbar el proceso.
      this.logger.warn(`No se pudo drenar el buzón de correo entrante: ${errorText(error)}`);
    } finally {
      // En `finally` y no al final del `try`: una pasada que revienta no
      // puede dejar el freno echado para siempre y apagar el reloj entero.
      this.runningSince = null;
    }
  }
}
