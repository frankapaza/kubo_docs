import { HttpException, Logger } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import type { AvailabilityTicketsService, IncidentTicketContext } from '../availability-tickets.service';
import { labelForKind } from '../domain/diagnose';
import { MonitorIncidentEvent } from '../entities/monitor-incident-event.entity';
import { MonitorIncident } from '../entities/monitor-incident.entity';
import { MonitorServer } from '../entities/monitor-server.entity';
import { MonitorService } from '../entities/monitor-service.entity';
import {
  addEvent,
  isFailureKind,
  maxCriticality,
  num,
  numOrNull,
  PostCommitAction,
  TICKET_NOT_CREATED,
  TICKET_RESET_EVENTS,
} from './incident-store';

const is4xx = (e: unknown): e is HttpException =>
  e instanceof HttpException && e.getStatus() >= 400 && e.getStatus() < 500;

/**
 * Lado de tickets del evaluador. Corre fuera de las transacciones de las
 * señales. Un 4xx de `ensureTicket` (p. ej. `SISTEMA_AJENO`) no se arregla
 * reintentando: queda el evento `TICKET_NOT_CREATED` y el incidente no se
 * vuelve a intentar hasta que cambie (se reabre, sube a DOWN o se agrupa).
 * Un 5xx o un error desconocido se reintenta en el siguiente tick.
 */
export class TicketSync {
  constructor(
    private readonly ds: DataSource,
    private readonly tickets: AvailabilityTicketsService,
    private readonly logger: Logger,
  ) {}

  /** `attempted`: incidentes cuyo ticket ya se intentó en este tick (el barrido no repite). */
  async apply(a: Exclude<PostCommitAction, { type: 'CROSS_CHECK_DC' }>, now: Date, attempted: Set<number>): Promise<void> {
    try {
      switch (a.type) {
        case 'ENSURE_TICKET':
          attempted.add(a.incidentId);
          await this.ensure(a.incidentId, now, a.diagnosis);
          return;
        case 'REOPEN_TICKET':
          attempted.add(a.incidentId);
          await this.reopen(a.incidentId, now);
          return;
        case 'COMMENT': {
          const ticketId = await this.ticketOf(a.incidentId);
          if (ticketId !== null) await this.tickets.comment(ticketId, a.text, { incidentId: a.incidentId });
          return;
        }
        case 'RAISE_PRIORITY': {
          const ticketId = await this.ticketOf(a.incidentId);
          if (ticketId !== null) await this.tickets.raisePriority(ticketId, a.criticality);
          return;
        }
      }
    } catch (e) {
      this.logger.warn(`Acción de ticket ${a.type} del incidente ${a.incidentId} falló: ${(e as Error).message}`);
    }
  }

  /** Recuperación tras una caída del worker: incidentes DOWN/ROUTE abiertos (de primer nivel) sin ticket. */
  async sweep(now: Date, attempted: Set<number>): Promise<void> {
    const pending = await this.ds.manager.getRepository(MonitorIncident).find({
      where: { recoveredAt: IsNull(), ticketId: IsNull(), parentId: IsNull(), kind: In(['DOWN', 'ROUTE']) },
      order: { id: 'ASC' },
    });
    for (const inc of pending) {
      if (attempted.has(num(inc.id))) continue;
      await this.apply({ type: 'ENSURE_TICKET', incidentId: num(inc.id) }, now, attempted);
    }
  }

  private async load(id: number): Promise<MonitorIncident | null> {
    return this.ds.manager.getRepository(MonitorIncident).findOne({ where: { id } });
  }

  private async ticketOf(id: number): Promise<number | null> {
    const inc = await this.load(id);
    return inc ? numOrNull(inc.ticketId) : null;
  }

  private async ensure(id: number, now: Date, diagnosis?: string): Promise<void> {
    const inc = await this.load(id);
    if (!inc || inc.recoveredAt !== null || inc.ticketId !== null || !isFailureKind(inc.kind)) return;
    if (await this.blockedBy4xx(id)) return;
    const ctx = await this.context(inc, diagnosis);
    await this.guard4xx(id, now, async () => {
      const ticket = await this.tickets.ensureTicket(inc, ctx);
      await this.link(id, null, num(ticket.id));
    });
  }

  private async reopen(id: number, now: Date): Promise<void> {
    const inc = await this.load(id);
    if (!inc || !isFailureKind(inc.kind)) return;
    const current = numOrNull(inc.ticketId);
    if (current === null) return this.ensure(id, now);
    const ctx = await this.context(inc);
    await this.guard4xx(id, now, async () => {
      const ticket = await this.tickets.reopenOrReplace(inc, current, ctx);
      if (num(ticket.id) !== current) await this.link(id, current, num(ticket.id));
    });
  }

  private async guard4xx(id: number, now: Date, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (e) {
      if (!is4xx(e)) throw e;
      await addEvent(this.ds.manager, id, now, TICKET_NOT_CREATED, {
        status: e.getStatus(),
        message: e.message,
        response: e.getResponse() as unknown,
      });
      this.logger.warn(`Ticket del incidente ${id} no creado (${e.getStatus()}): ${e.message}`);
    }
  }

  /** ¿El último intento de ticket fue un 4xx y desde entonces el incidente no cambió? */
  private async blockedBy4xx(id: number): Promise<boolean> {
    const last = await this.ds.manager.getRepository(MonitorIncidentEvent).findOne({
      where: { incidentId: id, type: In([TICKET_NOT_CREATED, ...TICKET_RESET_EVENTS]) },
      order: { id: 'DESC' },
    });
    return last?.type === TICKET_NOT_CREATED;
  }

  /** Guarda el ticket en el incidente y en sus hijos que no tengan otro (o que tuvieran el reemplazado). */
  private async link(id: number, previous: number | null, ticketId: number): Promise<void> {
    const repo = this.ds.manager.getRepository(MonitorIncident);
    const was = previous === null ? IsNull() : previous;
    await repo.update({ id, ticketId: was }, { ticketId });
    await repo.update({ parentId: id, ticketId: was }, { ticketId });
  }

  /**
   * Diagnóstico real guardado al abrir o reabrir (evento OPENED/REOPENED), si
   * sigue valiendo para el tipo actual: tras UPGRADED_TO_DOWN, o sin evento
   * (incidente de servidor), se usa el texto del tipo.
   */
  private async storedDiagnosis(inc: MonitorIncident): Promise<string> {
    const kind = inc.kind === 'ROUTE' ? 'ROUTE' : 'DOWN';
    const last = await this.ds.manager.getRepository(MonitorIncidentEvent).findOne({
      where: { incidentId: num(inc.id), type: In(['OPENED', 'REOPENED', 'UPGRADED_TO_DOWN']) },
      order: { id: 'DESC' },
    });
    const detail = last?.detail as { kind?: unknown; diagnosis?: unknown } | null | undefined;
    if (detail && detail.kind === kind && typeof detail.diagnosis === 'string') return detail.diagnosis;
    return labelForKind(kind);
  }

  async context(inc: MonitorIncident, diagnosis?: string): Promise<IncidentTicketContext> {
    const m = this.ds.manager;
    const server = await m.getRepository(MonitorServer).findOne({ where: { id: num(inc.serverId) } });
    if (!server) throw new Error(`Servidor ${inc.serverId} del incidente ${inc.id} no existe`);
    let serviceIds: number[];
    if (inc.serviceId !== null) {
      serviceIds = [num(inc.serviceId)];
    } else {
      const children = await m.getRepository(MonitorIncident).find({ where: { parentId: num(inc.id) }, order: { confirmedAt: 'ASC' } });
      const open = children.filter((c) => c.recoveredAt === null);
      serviceIds = (open.length ? open : children).map((c) => num(c.serviceId));
    }
    const found = serviceIds.length ? await m.getRepository(MonitorService).find({ where: { id: In(serviceIds) } }) : [];
    const byId = new Map(found.map((s) => [num(s.id), s]));
    const services = serviceIds.map((id) => byId.get(id)).filter((s): s is MonitorService => !!s);
    const systems = new Set(services.map((s) => numOrNull(s.systemId)));
    const only = systems.size === 1 ? [...systems][0] : null;
    return {
      clientId: num(server.clientId),
      // Solo si todos los servicios cuelgan del mismo sistema (decisión 13: no se inventa uno).
      systemId: only ?? null,
      criticality: maxCriticality(services.map((s) => s.criticality)),
      serviceNames: services.map((s) => s.name),
      serverName: server.name,
      diagnosis: diagnosis ?? (await this.storedDiagnosis(inc)),
    };
  }
}
