import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { isDuplicateEntry } from '../../common/db-errors';
import { PERU_UTC_OFFSET_MINUTES } from '../../common/peru-month';
import { ClientsRepository } from '../clients/clients.repository';
import { TicketStatus } from '../tickets/domain/ticket-state-machine';
import { ErrorNewPayload, TicketsRealtimeGateway } from '../tickets/tickets-realtime.gateway';
import { TicketsRepository } from '../tickets/tickets.repository';
import { computeErrorFingerprint } from './domain/error-fingerprint';
import { decideOnOccurrence, ErrorGroupStatus, GroupState, OccurrenceDecision } from './domain/error-group-state';
import { peruDay } from './domain/event-time';
import { LogLevel } from './domain/log-level';
import { ErrorListQueryDto } from './dto/error-group.dto';
import { ErrorGroup } from './entities/error-group.entity';
import { ErrorGroupRow, ErrorGroupsRepository, NewOccurrence, OccurrenceRow, SqlWhere } from './error-groups.repository';

/** De dónde viene el lote: lo común a todos sus eventos. */
export interface OccurrenceContext {
  installationId: number;
  aplicativo: string;
  servidor: string;
  receivedAt: Date;
}

/** Un evento ERROR/FATAL ya validado y con cliente/sistema resueltos por la ingesta. */
export interface ErrorEventInput {
  at: Date;
  clientId: number | null;
  systemId: number | null;
  nivel: LogLevel;
  logger: string;
  mensaje: string;
  excepcion: string | null;
  hilo: string | null;
  propiedades: Record<string, string>;
}

export interface ErrorGroupView {
  id: number;
  title: string;
  exceptionType: string | null;
  aplicativo: string;
  logger: string;
  installationId: number;
  clientId: number | null;
  clientName: string | null;
  systemId: number | null;
  systemName: string | null;
  status: ErrorGroupStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrencesTotal: number;
  servers: string[];
  reopenedAt: string | null;
  reopenReason: string | null;
  ticket: { id: number; code: string; status: TicketStatus } | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
}

export interface ErrorOccurrenceView {
  id: number;
  occurredAt: string;
  servidor: string;
  hilo: string | null;
  logger: string;
  message: string;
  exception: string | null;
  properties: Record<string, string> | null;
}

export type ErrorGroupDetailView = ErrorGroupView & {
  occurrences: ErrorOccurrenceView[];
  daily: Array<{ day: string; count: number }>;
};

/** Muestras por grupo (restricciones globales: 50). */
export const MAX_SAMPLES = 50;
/** Tope de servidores recordados por grupo: un error de granja no infla la fila sin fin. */
export const MAX_SERVERS = 20;
/** `errors:changed` como mucho cada 5 s: la lista del panel no se recarga en cada lote. */
export const ERRORS_CHANGED_MIN_INTERVAL_MS = 5000;
const DAILY_WINDOW_DAYS = 30;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const DAY_MS = 24 * 3600 * 1000;

const ORDER_BY = {
  ultima: 'g.last_seen_at DESC, g.id DESC',
  cantidad: 'g.occurrences_total DESC, g.last_seen_at DESC, g.id DESC',
} as const;

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const idOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** El driver devuelve JSON ya parseado; se tolera también la cadena por si cambia la configuración. */
function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

/** `%`, `_` y `\` son comodines de LIKE: lo que escribe el usuario se busca literal. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Inicio (UTC) de un día civil de Perú `YYYY-MM-DD`, sin depender de la zona del proceso. */
function peruDayStart(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - PERU_UTC_OFFSET_MINUTES * 60_000);
}

const isDayOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Bytes de una columna TEXT de MySQL. */
const TEXT_MAX_BYTES = 65535;

/**
 * Recorta a lo que cabe en una columna TEXT. La ingesta corta a 32768
 * caracteres, pero en utf8mb4 eso puede pasar de 65535 bytes (una «ñ» ya son
 * 2 bytes) y en modo estricto MySQL rechazaría la fila y con ella el grupo.
 */
export function fitTextBytes(s: string): string {
  if (Buffer.byteLength(s, 'utf8') <= TEXT_MAX_BYTES) return s;
  let out = Buffer.from(s, 'utf8').subarray(0, TEXT_MAX_BYTES).toString('utf8');
  // Un corte a mitad de carácter deja U+FFFD (3 bytes): se quita hasta caber.
  while (Buffer.byteLength(out, 'utf8') > TEXT_MAX_BYTES || out.endsWith('�')) out = out.slice(0, -1);
  return out;
}

/** Lo que se calcula de una huella dentro de un lote. */
interface FingerprintBatch {
  fingerprint: string;
  exceptionType: string | null;
  title: string;
  clientId: number | null;
  systemId: number | null;
  logger: string;
  events: ErrorEventInput[];
}

@Injectable()
export class ErrorGroupsService implements OnModuleDestroy {
  private readonly log = new Logger(ErrorGroupsService.name);
  private lastChangedAt = 0;
  private changedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly repo: ErrorGroupsRepository,
    private readonly tickets: TicketsRepository,
    private readonly clients: ClientsRepository,
    private readonly gateway: TicketsRealtimeGateway,
  ) {}

  onModuleDestroy(): void {
    if (this.changedTimer) clearTimeout(this.changedTimer);
    this.changedTimer = null;
  }

  // ---------------------------------------------------------------- registro

  /**
   * Registra los errores de un lote. Una transacción por huella y no una por
   * lote: el bloqueo de cada grupo dura lo mínimo y un grupo que falla no
   * deshace los demás. Si alguno falla se procesan los restantes igual y al
   * final se relanza el primer error (la ingesta decide qué hacer con él).
   *
   * Los avisos al panel salen DESPUÉS de confirmar: avisar de un grupo cuya
   * transacción luego se revierte mostraría un error que no existe.
   */
  async recordOccurrences(ctx: OccurrenceContext, events: ErrorEventInput[]): Promise<void> {
    if (events.length === 0) return;
    const batches = this.groupByFingerprint(ctx, events);

    const toNotify: Array<{ groupId: number; group: ErrorGroup | null; batch: FingerprintBatch; decision: OccurrenceDecision }> = [];
    let changed = false;
    let firstError: unknown = null;

    for (const batch of batches) {
      try {
        const r = await this.repo.runInTransaction((m) => this.recordOne(m, ctx, batch));
        changed = true;
        if (r.decision.notify) toNotify.push({ ...r, batch });
      } catch (e) {
        firstError ??= e;
        this.log.error(`No se pudo registrar el grupo ${batch.fingerprint}: ${(e as Error)?.message ?? e}`);
      }
    }

    for (const n of toNotify) {
      await this.notifyNew(n.groupId, n.group, n.batch, ctx, n.decision);
    }
    if (changed && toNotify.length === 0) this.notifyChangedThrottled();

    if (firstError) throw firstError;
  }

  /** Separa el lote por huella. El cliente y el sistema son del evento (la ingesta ya resolvió `kubo:ruc`). */
  private groupByFingerprint(ctx: OccurrenceContext, events: ErrorEventInput[]): FingerprintBatch[] {
    const byFp = new Map<string, FingerprintBatch>();
    for (const e of events) {
      const fp = computeErrorFingerprint({
        // Mismos valores que las etiquetas de Loki (`interno`, `ninguno`).
        clienteKey: e.clientId === null || e.clientId === undefined ? 'interno' : String(e.clientId),
        sistemaKey: e.systemId === null || e.systemId === undefined ? 'ninguno' : String(e.systemId),
        aplicativo: ctx.aplicativo,
        logger: e.logger,
        mensaje: e.mensaje,
        excepcion: e.excepcion,
      });
      let b = byFp.get(fp.fingerprint);
      if (!b) {
        b = {
          fingerprint: fp.fingerprint,
          exceptionType: fp.exceptionType,
          title: fp.title,
          clientId: idOrNull(e.clientId),
          systemId: idOrNull(e.systemId),
          logger: e.logger,
          events: [],
        };
        byFp.set(fp.fingerprint, b);
      }
      b.events.push(e);
    }
    for (const b of byFp.values()) b.events.sort((a, c) => a.at.getTime() - c.at.getTime());
    return [...byFp.values()];
  }

  private async recordOne(
    m: EntityManager,
    ctx: OccurrenceContext,
    batch: FingerprintBatch,
  ): Promise<{ groupId: number; group: ErrorGroup | null; decision: OccurrenceDecision }> {
    const first = batch.events[0].at;
    const latest = batch.events[batch.events.length - 1].at;

    let group = await this.repo.lockByFingerprint(m, batch.fingerprint);
    let created = false;
    if (!group) {
      try {
        // Se crea con total 0 y sin servidores: la suma va por el mismo
        // camino que un grupo existente, así no hay dos lógicas.
        await this.repo.insertGroup(m, {
          fingerprint: batch.fingerprint,
          installationId: ctx.installationId,
          clientId: batch.clientId,
          systemId: batch.systemId,
          aplicativo: ctx.aplicativo,
          exceptionType: batch.exceptionType?.slice(0, 255) ?? null,
          title: batch.title.slice(0, 300),
          logger: batch.logger.slice(0, 255),
          firstSeenAt: first,
          lastSeenAt: latest,
          occurrencesTotal: 0,
          servers: [],
          status: 'NUEVO',
        });
        created = true;
      } catch (e) {
        // Otro lote creó el grupo entre nuestro SELECT y el INSERT. En MySQL
        // el choque solo revierte la sentencia, no la transacción: se relee
        // con bloqueo (esperando a que el otro confirme) y se suma encima.
        if (!isDuplicateEntry(e)) throw e;
      }
      group = await this.repo.lockByFingerprint(m, batch.fingerprint);
      if (!group) throw new Error(`El grupo ${batch.fingerprint} no aparece tras crearlo`);
    }

    const decision = created ? decideOnOccurrence(null, latest) : decideOnOccurrence(await this.stateOf(group), latest);
    const groupId = Number(group.id);

    const current = parseJson<string[]>(group.servers, []);
    const servers = current.includes(ctx.servidor) || current.length >= MAX_SERVERS ? current : [...current, ctx.servidor];

    await this.repo.applyBatch(m, groupId, {
      firstSeenAt: first,
      lastSeenAt: latest,
      count: batch.events.length,
      servers,
      status: decision.status,
      reopen: decision.reopened ? { at: new Date(), reason: decision.reason ?? '' } : null,
    });

    // Solo las 50 más recientes: insertar 1000 para borrar 950 es trabajo tirado.
    const samples: NewOccurrence[] = batch.events.slice(-MAX_SAMPLES).map((e) => ({
      groupId,
      occurredAt: e.at,
      servidor: ctx.servidor,
      // Topes de las columnas: el contrato no acota hilo ni logger.
      hilo: e.hilo?.slice(0, 100) ?? null,
      logger: e.logger.slice(0, 255),
      message: fitTextBytes(e.mensaje),
      exception: e.excepcion === null ? null : fitTextBytes(e.excepcion),
      properties: Object.keys(e.propiedades ?? {}).length ? e.propiedades : null,
      receivedAt: ctx.receivedAt,
    }));
    await this.repo.insertOccurrences(m, samples);
    await this.repo.trimOccurrences(m, groupId, MAX_SAMPLES);

    const perDay = new Map<string, number>();
    for (const e of batch.events) {
      const day = peruDay(e.at);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    await this.repo.addDaily(
      m,
      groupId,
      [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count })),
    );

    return { groupId, group: created ? null : group, decision };
  }

  /**
   * Estado del grupo para decidir. El ticket se lee fuera del bloqueo (con el
   * repositorio inyectado): es solo una lectura de otra tabla, no participa
   * de la escritura y no hace falta que vea un estado transaccional.
   */
  private async stateOf(group: ErrorGroup): Promise<GroupState> {
    let ticket: GroupState['ticket'] = null;
    if (group.status === 'CON_TICKET' && group.ticketId !== null && group.ticketId !== undefined) {
      const t = await this.tickets.findById(Number(group.ticketId));
      ticket = t
        ? { code: t.code ?? `#${t.id}`, status: t.status, resolvedAt: t.resolvedAt ?? null, closedAt: t.closedAt ?? null }
        : null;
    }
    return {
      status: group.status,
      resolvedAt: group.resolvedAt ? new Date(group.resolvedAt) : null,
      ticketId: idOrNull(group.ticketId),
      ticket,
    };
  }

  private async notifyNew(
    groupId: number,
    group: ErrorGroup | null,
    batch: FingerprintBatch,
    ctx: OccurrenceContext,
    decision: OccurrenceDecision,
  ): Promise<void> {
    try {
      const clientId = group ? idOrNull(group.clientId) : batch.clientId;
      const clienteNombre = clientId === null ? null : ((await this.clients.findById(clientId))?.razonSocial ?? null);
      const payload: ErrorNewPayload = {
        id: groupId,
        title: group?.title ?? batch.title,
        aplicativo: group?.aplicativo ?? ctx.aplicativo,
        clienteNombre,
        reopened: decision.reopened,
        reason: decision.reason,
      };
      this.gateway.notifyErrorNew(payload);
      // notifyErrorNew ya emite errors:changed: cuenta para el intervalo.
      this.lastChangedAt = Date.now();
    } catch (e) {
      // El aviso es accesorio: el registro ya está confirmado.
      this.log.warn(`No se pudo avisar del error ${groupId}: ${(e as Error)?.message ?? e}`);
    }
  }

  /**
   * Como mucho un `errors:changed` cada 5 s. Si llega un cambio dentro del
   * intervalo se programa uno al final del mismo (uno solo), para que el
   * último lote no se quede sin reflejar en la lista.
   */
  private notifyChangedThrottled(): void {
    const now = Date.now();
    const wait = this.lastChangedAt + ERRORS_CHANGED_MIN_INTERVAL_MS - now;
    if (wait <= 0) {
      this.lastChangedAt = now;
      this.gateway.notifyErrorsChanged();
      return;
    }
    if (this.changedTimer) return;
    this.changedTimer = setTimeout(() => {
      this.changedTimer = null;
      this.lastChangedAt = Date.now();
      this.gateway.notifyErrorsChanged();
    }, wait);
    this.changedTimer.unref?.();
  }

  // ----------------------------------------------------------------- lectura

  async list(q: ErrorListQueryDto): Promise<{ items: ErrorGroupView[]; total: number }> {
    const pageSize = Math.min(Math.max(Number(q.pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const page = Math.max(Number(q.page) || 1, 1);
    const { rows, total } = await this.repo.list(
      this.buildWhere(q),
      ORDER_BY[q.orden ?? 'ultima'] ?? ORDER_BY.ultima,
      pageSize,
      (page - 1) * pageSize,
    );
    return { items: rows.map((r) => this.toView(r)), total };
  }

  async summary(): Promise<{ nuevos: number }> {
    return { nuevos: await this.repo.countByStatus('NUEVO') };
  }

  async detail(id: number): Promise<ErrorGroupDetailView> {
    const row = await this.repo.findRowById(id);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Error no encontrado' });

    // Ventana de 30 días de Perú terminando hoy. Perú no tiene horario de
    // verano: restar días de 24 h siempre cae en el día anterior.
    const now = Date.now();
    const days = Array.from({ length: DAILY_WINDOW_DAYS }, (_, i) =>
      peruDay(new Date(now - (DAILY_WINDOW_DAYS - 1 - i) * DAY_MS)),
    );
    const [occurrences, daily] = await Promise.all([
      this.repo.listOccurrences(id, MAX_SAMPLES),
      this.repo.dailySince(id, days[0]),
    ]);
    const counts = new Map(daily.map((d) => [String(d.day).slice(0, 10), Number(d.count)]));

    return {
      ...this.toView(row),
      occurrences: occurrences.map((o) => this.toOccurrenceView(o)),
      daily: days.map((day) => ({ day, count: counts.get(day) ?? 0 })),
    };
  }

  /** Traduce los filtros a SQL parametrizado. Ningún valor del usuario se concatena. */
  private buildWhere(q: ErrorListQueryDto): SqlWhere {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (q.cliente === 'interno') {
      clauses.push('g.client_id IS NULL');
    } else if (q.cliente) {
      clauses.push('g.client_id = ?');
      params.push(Number(q.cliente));
    }
    if (q.sistemaId) {
      clauses.push('g.system_id = ?');
      params.push(Number(q.sistemaId));
    }
    if (q.aplicativo) {
      clauses.push('g.aplicativo = ?');
      params.push(q.aplicativo);
    }
    if (q.servidor) {
      clauses.push('JSON_CONTAINS(g.servers, JSON_QUOTE(?))');
      params.push(q.servidor);
    }
    if (q.status) {
      clauses.push('g.status = ?');
      params.push(q.status);
    }
    // Rango: grupos vistos dentro del intervalo (se solapan con él). Un día
    // suelto es día de Perú; `hasta` con día incluye ese día entero.
    if (q.desde) {
      clauses.push('g.last_seen_at >= ?');
      params.push(isDayOnly(q.desde) ? peruDayStart(q.desde) : new Date(q.desde));
    }
    if (q.hasta) {
      if (isDayOnly(q.hasta)) {
        clauses.push('g.first_seen_at < ?');
        params.push(new Date(peruDayStart(q.hasta).getTime() + DAY_MS));
      } else {
        clauses.push('g.first_seen_at <= ?');
        params.push(new Date(q.hasta));
      }
    }
    if (q.q?.trim()) {
      const like = `%${escapeLike(q.q.trim())}%`;
      clauses.push('(g.title LIKE ? OR g.logger LIKE ? OR g.exception_type LIKE ?)');
      params.push(like, like, like);
    }
    if (q.ticketId) {
      clauses.push('g.ticket_id = ?');
      params.push(Number(q.ticketId));
    }
    return { clauses, params };
  }

  /** Proyección con lista blanca: la huella y las columnas internas no salen. */
  private toView(r: ErrorGroupRow): ErrorGroupView {
    const ticketId = idOrNull(r.ticket_id);
    return {
      id: Number(r.id),
      title: r.title,
      exceptionType: r.exception_type,
      aplicativo: r.aplicativo,
      logger: r.logger,
      installationId: Number(r.installation_id),
      clientId: idOrNull(r.client_id),
      clientName: r.client_name ?? null,
      systemId: idOrNull(r.system_id),
      systemName: r.system_name ?? null,
      status: r.status,
      firstSeenAt: iso(r.first_seen_at)!,
      lastSeenAt: iso(r.last_seen_at)!,
      occurrencesTotal: Number(r.occurrences_total),
      servers: parseJson<string[]>(r.servers, []),
      reopenedAt: iso(r.reopened_at),
      reopenReason: r.reopen_reason ?? null,
      // Un ticket borrado (sin fila en el JOIN) no se muestra como enlace roto.
      ticket:
        ticketId !== null && r.ticket_status
          ? { id: ticketId, code: r.ticket_code ?? `#${ticketId}`, status: r.ticket_status as TicketStatus }
          : null,
      resolvedAt: iso(r.resolved_at),
      resolvedByName: r.resolved_by_name ?? null,
      resolutionNote: r.resolution_note ?? null,
    };
  }

  private toOccurrenceView(o: OccurrenceRow): ErrorOccurrenceView {
    return {
      id: Number(o.id),
      occurredAt: iso(o.occurred_at)!,
      servidor: o.servidor,
      hilo: o.hilo ?? null,
      logger: o.logger,
      message: o.message,
      exception: o.exception ?? null,
      properties: parseJson<Record<string, string> | null>(o.properties, null),
    };
  }
}
