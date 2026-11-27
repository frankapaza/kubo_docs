import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';

import { PortalRequirementsService } from '../portal/portal-requirements.service';
import { PortalTicketsService } from '../portal/portal-tickets.service';
import { ClientSystemsRepository } from '../tickets/client-systems.repository';
import { TICKET_PRIORITIES } from '../tickets/domain/ticket-priority';
import { TICKET_STATUSES } from '../tickets/domain/ticket-state-machine';
import { INTERNAL_TICKET_ORIGINS, Ticket } from '../tickets/entities/ticket.entity';
import { PRE_BOARD_STATUSES, WORK_ITEM_PRIORITIES, WORK_ITEM_STATUSES } from '../work-items/domain/work-item-board';
import { WorkItem } from '../work-items/entities/work-item.entity';
import { encodeCursor, ListQuery } from './domain/list-query';
import {
  RequerimientoApiView,
  SistemaApiView,
  TicketApiDetail,
  TicketApiView,
  toHistoryEntry,
  toRequerimientoApiView,
  toTicketApiView,
} from './domain/views';

export interface Page<T> {
  datos: T[];
  siguienteCursor: string | null;
}

/** Valores que admiten los filtros `estado` y `prioridad` de cada lista. */
export const TICKET_FILTERS = { estados: TICKET_STATUSES as readonly string[], prioridades: TICKET_PRIORITIES as readonly string[] };
export const REQUIREMENT_FILTERS = { estados: WORK_ITEM_STATUSES as readonly string[], prioridades: WORK_ITEM_PRIORITIES as readonly string[] };

const notFound = (what: string) => new NotFoundException({ code: 'NOT_FOUND', message: `${what} no encontrado` });

/**
 * Consultas de la API de integración. Misma frontera que el portal: tickets
 * del cliente sin los de origen interno, requerimientos de origen PORTAL. El
 * `clientId` llega siempre de la clave (`ApiKeyGuard`), nunca de la petición.
 */
@Injectable()
export class IntegrationQueryService {
  constructor(
    @InjectRepository(Ticket) private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(WorkItem) private readonly workItems: Repository<WorkItem>,
    private readonly systems: ClientSystemsRepository,
    private readonly portalTickets: PortalTicketsService,
    private readonly portalRequirements: PortalRequirementsService,
  ) {}

  async sistemas(clientId: number): Promise<SistemaApiView[]> {
    const rows = await this.systems.listActiveByClient(clientId);
    return rows.map((s) => ({ id: Number(s.id), nombre: s.name }));
  }

  async tickets(clientId: number, q: ListQuery): Promise<Page<TicketApiView>> {
    const qb = this.ticketRepo
      .createQueryBuilder('t')
      .where('t.client_id = :clientId', { clientId })
      .andWhere('t.origin NOT IN (:...internal)', { internal: INTERNAL_TICKET_ORIGINS });
    if (q.estados) qb.andWhere('t.status IN (:...estados)', { estados: q.estados });
    if (q.prioridades) qb.andWhere('t.priority IN (:...prioridades)', { prioridades: q.prioridades });
    if (q.sistemaId) qb.andWhere('t.system_id = :sistemaId', { sistemaId: q.sistemaId });
    applyCommon(qb, 't', q);
    const rows = await qb.getMany();
    const names = await this.systemNames(clientId);
    return page(rows, q.limite, (t) => toTicketApiView(t, names));
  }

  /** Por código; uno ajeno, interno o inexistente da el mismo 404. */
  async ticket(clientId: number, codigo: string): Promise<TicketApiDetail> {
    const t = await this.ticketRepo
      .createQueryBuilder('t')
      .where('t.code = :codigo AND t.client_id = :clientId', { codigo, clientId })
      .andWhere('t.origin NOT IN (:...internal)', { internal: INTERNAL_TICKET_ORIGINS })
      .getOne();
    if (!t) throw notFound('Ticket');
    // El historial sale del portal: mismos eventos visibles y sin datos internos.
    const portal = await this.portalTickets.detail(clientId, Number(t.id));
    return { ...toTicketApiView(t, await this.systemNames(clientId)), historial: (portal.timeline ?? []).map(toHistoryEntry) };
  }

  async requerimientos(clientId: number, q: ListQuery): Promise<Page<RequerimientoApiView>> {
    const qb = this.workItems
      .createQueryBuilder('w')
      .where('w.client_id = :clientId', { clientId })
      .andWhere("w.origin = 'PORTAL'");
    if (q.estados) qb.andWhere('w.status IN (:...estados)', { estados: q.estados });
    if (q.prioridades) {
      qb.andWhere('w.priority IN (:...prioridades)', { prioridades: q.prioridades });
      // La prioridad de un requerimiento aún no aceptado no se publica (sale null):
      // filtrar por ella no puede revelarla ni meter en el grupo los que no la tienen.
      qb.andWhere('w.status NOT IN (:...preBoard)', { preBoard: PRE_BOARD_STATUSES });
    }
    if (q.sistemaId) qb.andWhere('w.client_system_id = :sistemaId', { sistemaId: q.sistemaId });
    applyCommon(qb, 'w', q);
    return page(await qb.getMany(), q.limite, (w) => toRequerimientoApiView(w));
  }

  async requerimiento(clientId: number, codigo: string): Promise<RequerimientoApiView> {
    const w = await this.workItems.findOne({ where: { code: codigo, clientId, origin: 'PORTAL' } });
    if (!w) throw notFound('Requerimiento');
    const portal = await this.portalRequirements.findOne(clientId, Number(w.id));
    return toRequerimientoApiView(w, portal);
  }

  private async systemNames(clientId: number): Promise<Map<number, string>> {
    return new Map((await this.systems.listActiveByClient(clientId)).map((s) => [Number(s.id), s.name]));
  }
}

/** Fechas, cursor y orden estable (`updated_at`, `id`); pide uno de más para saber si hay página siguiente. */
function applyCommon<T extends object>(qb: SelectQueryBuilder<T>, a: string, q: ListQuery): void {
  if (q.creadosDesde) qb.andWhere(`${a}.created_at >= :creadosDesde`, { creadosDesde: q.creadosDesde });
  if (q.creadosHasta) qb.andWhere(`${a}.created_at <= :creadosHasta`, { creadosHasta: q.creadosHasta });
  if (q.actualizadosDesde) qb.andWhere(`${a}.updated_at >= :actualizadosDesde`, { actualizadosDesde: q.actualizadosDesde });
  if (q.cursor) {
    const { t, i } = q.cursor;
    qb.andWhere(
      new Brackets((w) => {
        w.where(`${a}.updated_at > :ct`, { ct: t }).orWhere(`(${a}.updated_at = :ct AND ${a}.id > :ci)`, { ct: t, ci: i });
      }),
    );
  }
  qb.orderBy(`${a}.updated_at`, 'ASC').addOrderBy(`${a}.id`, 'ASC').take(q.limite + 1);
}

function page<E extends { id: number; updatedAt: Date }, V>(rows: E[], limite: number, map: (e: E) => V): Page<V> {
  const more = rows.length > limite;
  const slice = more ? rows.slice(0, limite) : rows;
  const last = slice[slice.length - 1];
  return {
    datos: slice.map(map),
    siguienteCursor: more && last ? encodeCursor({ t: new Date(last.updatedAt), i: Number(last.id) }) : null,
  };
}
