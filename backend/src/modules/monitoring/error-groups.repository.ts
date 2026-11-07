import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { ErrorGroupStatus } from './domain/error-group-state';
import { ErrorGroup } from './entities/error-group.entity';
import { ErrorOccurrence } from './entities/error-occurrence.entity';

/** Filtro ya traducido a SQL por el servicio: el repositorio solo lo ejecuta. */
export interface SqlWhere {
  clauses: string[];
  params: unknown[];
}

/** Lo que se suma a un grupo por un lote (una huella). */
export interface GroupBatchUpdate {
  firstSeenAt: Date;
  lastSeenAt: Date;
  count: number;
  servers: string[];
  status: ErrorGroupStatus;
  /** Solo si el lote reabrió el grupo; si no, se conservan los anteriores. */
  reopen: { at: Date; reason: string } | null;
}

export type NewOccurrence = Omit<ErrorOccurrence, 'id'>;

/**
 * Fila cruda de la lista/detalle: el grupo con los nombres ya unidos
 * (cliente, sistema, ticket, quién resolvió) para no hacer una consulta por
 * fila. Los bigint llegan como cadena y los DATETIME como Date (timezone 'Z').
 */
export interface ErrorGroupRow {
  id: string | number;
  title: string;
  exception_type: string | null;
  aplicativo: string;
  logger: string;
  installation_id: string | number;
  client_id: string | number | null;
  client_name: string | null;
  system_id: string | number | null;
  system_name: string | null;
  status: ErrorGroupStatus;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  occurrences_total: string | number;
  servers: unknown;
  reopened_at: Date | string | null;
  reopen_reason: string | null;
  ticket_id: string | number | null;
  ticket_code: string | null;
  ticket_status: string | null;
  resolved_at: Date | string | null;
  resolved_by_name: string | null;
  resolution_note: string | null;
}

export interface OccurrenceRow {
  id: string | number;
  occurred_at: Date | string;
  servidor: string;
  hilo: string | null;
  logger: string;
  message: string;
  exception: string | null;
  properties: unknown;
}

/**
 * LEFT JOIN y no JOIN: cliente, sistema, ticket y usuario no tienen clave
 * foránea (a propósito) y un grupo cuyo ticket se borró debe seguir saliendo.
 */
const SELECT_VIEW = `
  SELECT g.id, g.title, g.exception_type, g.aplicativo, g.logger, g.installation_id,
         g.client_id, c.razon_social AS client_name,
         g.system_id, s.name AS system_name,
         g.status, g.first_seen_at, g.last_seen_at, g.occurrences_total, g.servers,
         g.reopened_at, g.reopen_reason,
         g.ticket_id, t.code AS ticket_code, t.status AS ticket_status,
         g.resolved_at, u.full_name AS resolved_by_name, g.resolution_note
    FROM error_groups g
    LEFT JOIN clients c ON c.id = g.client_id
    LEFT JOIN systems s ON s.id = g.system_id
    LEFT JOIN tickets t ON t.id = g.ticket_id
    LEFT JOIN users u ON u.id = g.resolved_by`;

@Injectable()
export class ErrorGroupsRepository {
  constructor(
    @InjectRepository(ErrorGroup) private readonly groups: Repository<ErrorGroup>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Una transacción. Quien llame hace TODO a través del `EntityManager`
   * recibido (los métodos de abajo lo piden como primer argumento), nunca
   * con el repositorio inyectado: solo así el bloqueo y las escrituras
   * comparten conexión y confirman o revierten juntos.
   */
  runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  // ------------------------------------------------- escritura (en transacción)

  /**
   * `SELECT ... FOR UPDATE` por huella: serializa los lotes del mismo error
   * para que dos no lean el mismo estado y sumen o reabran dos veces.
   */
  lockByFingerprint(manager: EntityManager, fingerprint: string): Promise<ErrorGroup | null> {
    return manager
      .getRepository(ErrorGroup)
      .createQueryBuilder('g')
      .setLock('pessimistic_write')
      .where('g.fingerprint = :fingerprint', { fingerprint })
      .getOne();
  }

  /** Crea el grupo; si otro lote lo creó a la vez, lanza ER_DUP_ENTRY (lo maneja el servicio). */
  async insertGroup(manager: EntityManager, data: Partial<ErrorGroup>): Promise<void> {
    await manager.getRepository(ErrorGroup).insert(data);
  }

  /**
   * Suma el lote al grupo. `GREATEST`/`LEAST` porque un lote puede traer
   * ocurrencias atrasadas (la cola del appender): la última vista nunca
   * retrocede ni la primera avanza. El total se suma en SQL, no se pisa con
   * un valor leído, por si algún día se escribe fuera de este bloqueo.
   */
  async applyBatch(manager: EntityManager, groupId: number, u: GroupBatchUpdate): Promise<void> {
    await manager.query(
      `UPDATE error_groups
          SET first_seen_at = LEAST(first_seen_at, ?),
              last_seen_at = GREATEST(last_seen_at, ?),
              occurrences_total = occurrences_total + ?,
              servers = CAST(? AS JSON),
              status = ?,
              reopened_at = IF(?, ?, reopened_at),
              reopen_reason = IF(?, ?, reopen_reason)
        WHERE id = ?`,
      [
        u.firstSeenAt,
        u.lastSeenAt,
        u.count,
        JSON.stringify(u.servers),
        u.status,
        u.reopen ? 1 : 0,
        u.reopen?.at ?? null,
        u.reopen ? 1 : 0,
        u.reopen?.reason ?? null,
        groupId,
      ],
    );
  }

  async insertOccurrences(manager: EntityManager, rows: NewOccurrence[]): Promise<void> {
    if (rows.length === 0) return;
    await manager.getRepository(ErrorOccurrence).insert(rows);
  }

  /**
   * Deja solo las `keep` muestras más recientes del grupo. La subconsulta va
   * envuelta en una tabla derivada porque MySQL no admite `LIMIT` dentro de
   * `IN (...)` ni leer de la misma tabla que se borra.
   */
  async trimOccurrences(manager: EntityManager, groupId: number, keep: number): Promise<void> {
    await manager.query(
      `DELETE FROM error_occurrences
        WHERE group_id = ?
          AND id NOT IN (
            SELECT id FROM (
              SELECT id FROM error_occurrences
               WHERE group_id = ?
               ORDER BY occurred_at DESC, id DESC
               LIMIT ?
            ) AS conservar
          )`,
      [groupId, groupId, keep],
    );
  }

  /** Suma al conteo de cada día; una sola sentencia para todos los días del lote. */
  async addDaily(manager: EntityManager, groupId: number, counts: Array<{ day: string; count: number }>): Promise<void> {
    if (counts.length === 0) return;
    const values = counts.map(() => '(?, ?, ?)').join(', ');
    const params = counts.flatMap((c) => [groupId, c.day, c.count]);
    await manager.query(
      `INSERT INTO error_group_daily (group_id, day, count)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE count = count + VALUES(count)`,
      params,
    );
  }

  // ------------------------------------------------------------------ lectura

  async list(
    where: SqlWhere,
    orderBy: string,
    limit: number,
    offset: number,
  ): Promise<{ rows: ErrorGroupRow[]; total: number }> {
    const whereSql = where.clauses.length ? `WHERE ${where.clauses.join(' AND ')}` : '';
    const rows: ErrorGroupRow[] = await this.groups.query(
      `${SELECT_VIEW} ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...where.params, limit, offset],
    );
    const [{ total }] = await this.groups.query(
      `SELECT COUNT(*) AS total FROM error_groups g ${whereSql}`,
      where.params,
    );
    return { rows, total: Number(total) };
  }

  async countByStatus(status: ErrorGroupStatus): Promise<number> {
    return this.groups.count({ where: { status } });
  }

  async findRowById(id: number): Promise<ErrorGroupRow | null> {
    const rows: ErrorGroupRow[] = await this.groups.query(`${SELECT_VIEW} WHERE g.id = ?`, [id]);
    return rows[0] ?? null;
  }

  listOccurrences(groupId: number, limit: number): Promise<OccurrenceRow[]> {
    return this.groups.query(
      `SELECT id, occurred_at, servidor, hilo, logger, message, exception, properties
         FROM error_occurrences
        WHERE group_id = ?
        ORDER BY occurred_at DESC, id DESC
        LIMIT ?`,
      [groupId, limit],
    );
  }

  /** Conteos desde `fromDay` (incluido). DATE llega como cadena `YYYY-MM-DD`. */
  dailySince(groupId: number, fromDay: string): Promise<Array<{ day: string; count: string | number }>> {
    return this.groups.query(
      `SELECT day, count FROM error_group_daily WHERE group_id = ? AND day >= ? ORDER BY day`,
      [groupId, fromDay],
    );
  }
}
