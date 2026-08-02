import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TicketEvent } from './entities/ticket-event.entity';

/**
 * Identificador de una fila tal y como puede llegar del código que la leyó:
 * TypeORM hidrata las columnas `bigint` como **cadena** aunque la entidad las
 * declare `number`. Aceptar ambos evita que quien llama tenga que convertir —y
 * que se olvide de hacerlo justo en el sitio donde importa.
 */
type TicketEventId = number | string;

@Injectable()
export class TicketEventsRepository {
  constructor(@InjectRepository(TicketEvent) private readonly repo: Repository<TicketEvent>) {}

  append(data: Partial<TicketEvent>): Promise<TicketEvent> {
    return this.repo.save(this.repo.create(data));
  }

  listByTicket(ticketId: number): Promise<TicketEvent[]> {
    return this.repo.find({ where: { ticketId }, order: { createdAt: 'ASC', id: 'ASC' } });
  }

  // ---------------------------------------------------------------------------
  // Bandeja de salida de avisos por correo. Las usa `NotificationScheduler`.
  //
  // Son las **únicas** escrituras que esta tabla append-only admite, y ninguna
  // toca el contenido del evento: solo la contabilidad de si ya se notificó.
  // ---------------------------------------------------------------------------

  /**
   * Las filas que faltan por notificar, las más antiguas primero.
   *
   * `ORDER BY id` y no por `created_at`: `created_at` es un `TIMESTAMP` con
   * resolución de segundo y varias filas del mismo ticket caen dentro del mismo,
   * así que no da un orden total. El `id` sí, y además es el orden del índice
   * `(notified_at, id)` que creó la migración 015, con lo que la consulta no
   * recorre la tabla.
   *
   * El filtro por la espera entre reintentos **no** está aquí a propósito: es
   * política del vigilante y vive en un solo sitio, en él, donde se puede
   * probar sin base de datos.
   */
  listPendingNotification(limit: number): Promise<TicketEvent[]> {
    return this.repo.find({
      where: { notifiedAt: IsNull() },
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
   */
  async markNotified(
    id: TicketEventId,
    notifiedAt: Date,
    attempts: number,
    lastError: string | null,
  ): Promise<void> {
    await this.repo.update(id, { notifiedAt, notifyAttempts: attempts, notifyLastError: lastError });
  }

  /**
   * Deja constancia de un intento fallido **sin sellar**: la fila sigue
   * pendiente y el vigilante la reintentará cuando toque.
   *
   * `attempts` llega calculado por quien llama en vez de un `UPDATE ... + 1`
   * porque es él quien decide, con ese mismo número, si esto era el último
   * intento; un incremento en la base devolvería el valor demasiado tarde.
   * Solo hay un vigilante escribiendo, así que no hay carrera que perder.
   */
  async recordNotifyFailure(
    id: TicketEventId,
    attempts: number,
    lastError: string | null,
  ): Promise<void> {
    await this.repo.update(id, { notifyAttempts: attempts, notifyLastError: lastError });
  }
}
