import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsSelect, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { TicketEvent } from './entities/ticket-event.entity';

/**
 * Identificador de una fila tal y como puede llegar del código que la leyó:
 * TypeORM hidrata las columnas `bigint` como **cadena** aunque la entidad las
 * declare `number`. Aceptar ambos evita que quien llama tenga que convertir —y
 * que se olvide de hacerlo justo en el sitio donde importa.
 */
type TicketEventId = number | string;

/**
 * El evento tal y como puede salir de aquí hacia una respuesta HTTP: el hecho
 * registrado, y nada de la contabilidad de notificación.
 *
 * Se enumera campo por campo, en positivo, y no como una lista de exclusiones:
 * así la columna que se añada dentro de seis meses **no** aparece sola en la
 * respuesta del panel. Es la misma disciplina con la que el portal proyecta sus
 * DTO y con la que el despachador construye los valores por público.
 */
export const TIMELINE_FIELDS: FindOptionsSelect<TicketEvent> = {
  id: true,
  ticketId: true,
  type: true,
  fromStatus: true,
  toStatus: true,
  actorUserId: true,
  actorClientUserId: true,
  reason: true,
  payload: true,
  createdAt: true,
};

@Injectable()
export class TicketEventsRepository {
  constructor(@InjectRepository(TicketEvent) private readonly repo: Repository<TicketEvent>) {}

  append(data: Partial<TicketEvent>): Promise<TicketEvent> {
    return this.repo.save(this.repo.create(data));
  }

  /**
   * El timeline de un ticket, **sin las columnas de notificación**.
   *
   * El `select` no es una optimización. `TicketsService.findWithTimeline`
   * devuelve estas entidades en crudo y el controlador las serializa tal cual,
   * así que sin él `GET /tickets/:id` publicaría `notifiedAt`,
   * `notifyAttempts`, `notifyLastError` y `notifyNextAttemptAt` en cada evento:
   * un cambio de contrato que nadie pidió y, sobre todo, un `notify_last_error`
   * que puede llevar dentro la dirección de correo que rebotó. El portal se
   * salva porque proyecta campo por campo; el panel no.
   *
   * Se corta aquí, en el repositorio, y no en el servicio: así queda cubierto
   * cualquier consumidor futuro sin que tenga que acordarse.
   */
  listByTicket(ticketId: number): Promise<TicketEvent[]> {
    return this.repo.find({
      where: { ticketId },
      order: { createdAt: 'ASC', id: 'ASC' },
      select: TIMELINE_FIELDS,
    });
  }

  // ---------------------------------------------------------------------------
  // Bandeja de salida de avisos por correo. Las usa `NotificationScheduler`.
  //
  // Son las **únicas** escrituras que esta tabla append-only admite, y ninguna
  // toca el contenido del evento: solo la contabilidad de si ya se notificó.
  // ---------------------------------------------------------------------------

  /**
   * Las filas que faltan por notificar **y a las que ya les toca**, las más
   * antiguas primero.
   *
   * Dos condiciones. `notified_at IS NULL` es la cola. Y de esa cola, solo las
   * que no están esperando su reintento: `notify_next_attempt_at` nula
   * —nunca falló— o ya vencida.
   *
   * El filtro de la espera va en el `WHERE` y no en memoria sobre el resultado,
   * y esa diferencia importa: filtrando después, las filas que aún esperan
   * gastarían sitio del lote y podrían tapar a las recién llegadas justo
   * mientras el sistema se recupera de una caída, que es cuando más cola hay.
   *
   * `ORDER BY id` y no por `created_at`: `created_at` es un `TIMESTAMP` con
   * resolución de segundo y varias filas del mismo ticket caen dentro del mismo,
   * así que no da un orden total. El `id` sí, y además es el orden del índice
   * `(notified_at, id)` que creó la migración 015.
   */
  listPendingNotification(limit: number, now: Date): Promise<TicketEvent[]> {
    return this.repo.find({
      // Un array de condiciones es un OR en TypeORM. `notifiedAt` se repite en
      // las dos ramas a propósito: es un AND con cada una, no un filtro común,
      // y sacarlo fuera no es expresable en esta API.
      where: [
        { notifiedAt: IsNull(), notifyNextAttemptAt: IsNull() },
        { notifiedAt: IsNull(), notifyNextAttemptAt: LessThanOrEqual(now) },
      ],
      order: { id: 'ASC' },
      take: limit,
    });
  }

  /**
   * Sella la fila: su destino como aviso ya está resuelto y no vuelve a la cola.
   *
   * `lastError` no es siempre un error — es la razón por la que no salió todo
   * lo que podía salir (sin plantilla activa, sin destinatario, el evento no
   * avisa a nadie, se agotaron los intentos), o `null` cuando salió limpio.
   * **Tiene que venir ya recortado**: la columna es `VARCHAR(500)`.
   *
   * Limpia `notify_next_attempt_at` porque una fila sellada no tiene siguiente
   * intento, y dejar ahí un instante futuro sería un dato que miente a quien
   * mire la tabla.
   *
   * `sentMessageId` **se exige siempre**, aunque casi siempre sea `null`, y no
   * es un parámetro opcional que alguien pueda olvidar: es el `Message-ID` con
   * el que salió el aviso al **cliente** (`NotificationDispatcher` solo lo
   * rellena para la entrada de público `CLIENT` de un plan; un aviso solo al
   * equipo, o un evento que no avisó a nadie, sella con `null` de verdad, no
   * por omisión). Antes de este cambio el despachador pedía el `messageId` a
   * `EmailService.send` y lo tiraba, así que esta columna nunca se llenaba y
   * la mitad de la correlación de respuestas —la que cubre un aviso posterior
   * al acuse inicial— estaba muerta desde que existe la tabla.
   */
  async markNotified(
    id: TicketEventId,
    notifiedAt: Date,
    attempts: number,
    lastError: string | null,
    sentMessageId: string | null,
  ): Promise<void> {
    await this.repo.update(id, {
      notifiedAt,
      notifyAttempts: attempts,
      notifyLastError: lastError,
      notifyNextAttemptAt: null,
      sentMessageId,
    });
  }

  /**
   * Deja constancia de un intento fallido **sin sellar**: la fila sigue
   * pendiente y no se vuelve a coger hasta `nextAttemptAt`.
   *
   * `attempts` llega calculado por quien llama en vez de un `UPDATE ... + 1`
   * porque es él quien decide, con ese mismo número, si esto era el último
   * intento y cuánto hay que esperar; un incremento en la base devolvería el
   * valor demasiado tarde. Solo hay un vigilante escribiendo, así que no hay
   * carrera que perder.
   */
  async recordNotifyFailure(
    id: TicketEventId,
    attempts: number,
    nextAttemptAt: Date,
    lastError: string | null,
  ): Promise<void> {
    await this.repo.update(id, {
      notifyAttempts: attempts,
      notifyNextAttemptAt: nextAttemptAt,
      notifyLastError: lastError,
    });
  }
}
