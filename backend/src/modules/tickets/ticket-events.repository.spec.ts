import { FindManyOptions, FindOptionsWhere, IsNull, getMetadataArgsStorage } from 'typeorm';

import { TicketEvent } from './entities/ticket-event.entity';
import { TIMELINE_FIELDS, TicketEventsRepository } from './ticket-events.repository';

/**
 * Estos tests miran las **opciones que se le pasan a TypeORM**, no el
 * resultado. Es deliberado: los dobles del vigilante implementan a mano el
 * filtro de la cola, así que si aquí no se comprobara el `WHERE` de verdad, un
 * error en la consulta pasaría entero por delante de la suite. Este fichero es
 * la otra mitad de esa pareja.
 */
function montar() {
  const find = jest.fn().mockResolvedValue([]);
  const update = jest.fn().mockResolvedValue({ affected: 1 });
  const repo = new TicketEventsRepository({ find, update } as any);
  return { repo, find, update };
}

/** Las opciones con las que se llamó a `find`, tipadas. */
function opcionesDe(find: jest.Mock): FindManyOptions<TicketEvent> {
  return find.mock.calls[0][0] as FindManyOptions<TicketEvent>;
}

const AHORA = new Date('2026-08-02T12:00:00Z');

describe('TicketEventsRepository', () => {
  describe('listByTicket', () => {
    /**
     * `TicketsService.findWithTimeline` devuelve estas entidades en crudo y el
     * controlador las serializa tal cual. Sin proyección, `GET /tickets/:id`
     * publicaría la contabilidad de notificación en cada evento del timeline —
     * y `notify_last_error` puede llevar dentro la dirección que rebotó.
     */
    it('no selecciona ninguna columna de notificación', async () => {
      const { repo, find } = montar();

      await repo.listByTicket(13);

      const select = opcionesDe(find).select as Record<string, unknown>;
      expect(select).toBeDefined();
      for (const prohibida of [
        'notifiedAt',
        'notifyAttempts',
        'notifyNextAttemptAt',
        'notifyLastError',
      ]) {
        expect(select[prohibida]).toBeUndefined();
      }
    });

    /**
     * La guarda que de verdad protege esto en el futuro.
     *
     * Comprobar que hoy no se cuela ninguna columna sirve hoy. Lo que hace
     * falta es que **la columna que se añada dentro de seis meses** no se
     * publique sola: esta lista se lee de los metadatos de la entidad, así que
     * añadir un `@Column` a `TicketEvent` rompe este test hasta que alguien
     * decida, a mano, si va al timeline o a la lista de exclusiones.
     */
    it('toda columna de la entidad está clasificada: o va al timeline o se excluye a mano', () => {
      /** Lo que nunca sale del repositorio hacia una respuesta HTTP. */
      const FUERA_DEL_TIMELINE = [
        'notifiedAt',
        'notifyAttempts',
        'notifyNextAttemptAt',
        'notifyLastError',
        // Migración 021: columna de la bandeja de salida de correo, igual que
        // las cuatro de arriba — contabilidad del envío, no el hecho del
        // ticket. Ver el comentario de `sentMessageId` en `TicketEvent`.
        'sentMessageId',
      ];

      const declaradas = getMetadataArgsStorage()
        .columns.filter((c) => c.target === TicketEvent)
        .map((c) => c.propertyName);

      // Si esto falla, la entidad cambió y nadie tocó esta clasificación.
      expect(declaradas.length).toBeGreaterThan(0);
      const clasificadas = [...Object.keys(TIMELINE_FIELDS), ...FUERA_DEL_TIMELINE].sort();
      expect(declaradas.slice().sort()).toEqual(clasificadas);
    });

    it('sí selecciona el hecho registrado, que es lo que el timeline enseña', async () => {
      const { repo, find } = montar();

      await repo.listByTicket(13);

      const select = opcionesDe(find).select as Record<string, unknown>;
      for (const campo of [
        'id',
        'ticketId',
        'type',
        'fromStatus',
        'toStatus',
        'actorUserId',
        'actorClientUserId',
        'reason',
        'payload',
        'createdAt',
      ]) {
        expect(select[campo]).toBe(true);
      }
    });
  });

  describe('listPendingNotification', () => {
    /**
     * La cola son las filas sin sellar **a las que ya les toca**. Las dos ramas
     * del OR son `notify_next_attempt_at` nula —nunca falló— y vencida, y las
     * dos llevan `notified_at IS NULL`: sin repetirlo, la rama de la espera
     * arrastraría también filas ya notificadas.
     */
    it('pide las pendientes ya vencidas, por orden de id y acotadas', async () => {
      const { repo, find } = montar();

      await repo.listPendingNotification(100, AHORA);

      const opciones = opcionesDe(find);
      const where = opciones.where as FindOptionsWhere<TicketEvent>[];

      expect(Array.isArray(where)).toBe(true);
      expect(where).toHaveLength(2);
      for (const rama of where) {
        expect(rama.notifiedAt).toEqual(IsNull());
      }
      expect(where[0].notifyNextAttemptAt).toEqual(IsNull());

      expect(opciones.order).toEqual({ id: 'ASC' });
      expect(opciones.take).toBe(100);
    });

    /**
     * El `now` que recibe `drain` tiene que llegar hasta la consulta: es lo que
     * hace que la espera se pueda probar sin esperar de verdad, y lo que la
     * mantiene fuera de un filtro en memoria (donde las filas que aguardan
     * gastarían sitio del lote y taparían a las recién llegadas).
     */
    it('compara la espera contra el instante que le pasan, no contra el reloj', async () => {
      const { repo, find } = montar();

      await repo.listPendingNotification(50, AHORA);

      const where = opcionesDe(find).where as FindOptionsWhere<TicketEvent>[];
      // El operador `LessThanOrEqual(AHORA)` guarda el valor en `.value`.
      const vencida = where[1].notifyNextAttemptAt as unknown as { value: Date; type: string };
      expect(vencida.type).toBe('lessThanOrEqual');
      expect(vencida.value).toEqual(AHORA);
    });
  });

  describe('escrituras de la bandeja de salida', () => {
    it('markNotified sella y limpia el siguiente intento', async () => {
      const { repo, update } = montar();

      await repo.markNotified('901', AHORA, 2, 'sin plantilla activa');

      expect(update).toHaveBeenCalledWith('901', {
        notifiedAt: AHORA,
        notifyAttempts: 2,
        notifyLastError: 'sin plantilla activa',
        // Una fila sellada no tiene siguiente intento: dejar ahí un instante
        // futuro sería un dato que miente a quien mire la tabla.
        notifyNextAttemptAt: null,
      });
    });

    it('recordNotifyFailure guarda la espera y NO sella', async () => {
      const { repo, update } = montar();
      const siguiente = new Date(AHORA.getTime() + 5 * 60_000);

      await repo.recordNotifyFailure('901', 1, siguiente, 'SMTP caído');

      const patch = update.mock.calls[0][1] as Record<string, unknown>;
      expect(patch).toEqual({
        notifyAttempts: 1,
        notifyNextAttemptAt: siguiente,
        notifyLastError: 'SMTP caído',
      });
      // Lo que no puede aparecer, ni siquiera como null: sellaría la fila.
      expect(patch).not.toHaveProperty('notifiedAt');
    });

    /**
     * TypeORM hidrata los `bigint` como cadena. Los métodos aceptan el id tal y
     * como venga y lo pasan sin convertir: `update` acepta ambos, y convertir
     * aquí solo añadiría un sitio donde perder precisión.
     */
    it('acepta el id como cadena, que es como llega de la base', async () => {
      const { repo, update } = montar();

      await repo.markNotified('9007199254740993', AHORA, 1, null);

      expect(update.mock.calls[0][0]).toBe('9007199254740993');
    });
  });
});
