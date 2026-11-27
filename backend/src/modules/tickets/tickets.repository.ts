import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

import { Ticket, ServiceCategory, INTERNAL_TICKET_ORIGINS } from './entities/ticket.entity';
import { TicketStatus, OPEN_STATUSES } from './domain/ticket-state-machine';
import { TicketPriority } from './domain/ticket-priority';

export interface TicketListFilters {
  status?: TicketStatus;
  open?: boolean;
  clientId?: number;
  /**
   * Oculta los tickets internos (origen `MONITOREO`). Lo pide el portal: esos
   * tickets son del equipo por decisión del responsable y el cliente no los ve.
   */
  excludeInternal?: boolean;
  /**
   * Solo los pendientes de clasificar: sin sistema, abiertos, no archivados,
   * de origen no interno y de un cliente que sí tiene sistemas activos. Es la
   * lista que abre el aviso «tickets sin sistema» (spec 2026-11-27-sistema-obligatorio).
   */
  sinSistema?: boolean;
  systemId?: number;
  priority?: TicketPriority;
  assigneeUserId?: number;
  serviceCategory?: ServiceCategory;
  atRisk?: boolean;
  q?: string;
  /** Oculta los CERRADO (vista "Todos" de la bandeja). */
  excludeClosed?: boolean;
  /**
   * Tri-estado: `true` = solo archivados, `false` = sin archivados,
   * `undefined` = no se filtra. Archivar es una decisión de la bandeja del
   * equipo; solo `TicketsController.list` lo pone. El portal lo deja sin
   * poner porque el cliente sigue viendo su ticket aunque el equipo lo archive.
   */
  archived?: boolean;
}

@Injectable()
export class TicketsRepository {
  constructor(
    @InjectRepository(Ticket) private readonly repo: Repository<Ticket>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Ejecuta `work` dentro de una única transacción de base de datos. Quien
   * llame debe hacer todas sus escrituras a través del `EntityManager` que
   * recibe (por ejemplo `manager.getRepository(Ticket)`), no de los
   * repositorios inyectados por Nest, para que compartan la misma conexión
   * y confirmen o reviertan juntas.
   */
  runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  async list(filters: TicketListFilters): Promise<Ticket[]> {
    const qb = this.repo.createQueryBuilder('t');

    if (filters.status) qb.andWhere('t.status = :status', { status: filters.status });
    if (filters.open) qb.andWhere('t.status IN (:...open)', { open: OPEN_STATUSES });
    if (filters.clientId) qb.andWhere('t.client_id = :clientId', { clientId: filters.clientId });
    if (filters.excludeInternal) {
      qb.andWhere('t.origin NOT IN (:...internal)', { internal: INTERNAL_TICKET_ORIGINS });
    }
    if (filters.systemId) qb.andWhere('t.system_id = :systemId', { systemId: filters.systemId });
    if (filters.priority) qb.andWhere('t.priority = :priority', { priority: filters.priority });
    if (filters.assigneeUserId) {
      qb.andWhere('t.assignee_user_id = :assignee', { assignee: filters.assigneeUserId });
    }
    if (filters.serviceCategory) {
      qb.andWhere('t.service_category = :cat', { cat: filters.serviceCategory });
    }
    if (filters.atRisk) qb.andWhere('t.sla_at_risk = 1');
    if (filters.excludeClosed) qb.andWhere("t.status <> 'CERRADO'");
    // Archivar es "no lo quiero ver" del equipo: en su bandeja un archivado no
    // sale salvo en su propio filtro. Pero solo se filtra si quien llama lo
    // pide; antes se aplicaba siempre y el portal perdía los tickets que el
    // equipo archivaba.
    if (filters.sinSistema) applyWithoutSystem(qb);
    if (filters.archived === true) qb.andWhere('t.archived_at IS NOT NULL');
    else if (filters.archived === false) qb.andWhere('t.archived_at IS NULL');
    if (filters.q) {
      qb.andWhere('(t.raw_text LIKE :q OR t.subject LIKE :q OR t.code LIKE :q)', {
        q: `%${filters.q}%`,
      });
    }

    qb.orderBy('t.created_at', 'DESC').limit(500);
    return qb.getMany();
  }

  /** Cuántos tickets pendientes de clasificar hay, por cliente (mismas condiciones que `sinSistema`). */
  async summaryWithoutSystem(): Promise<Array<{ clientId: number; cliente: string; total: number }>> {
    const qb = this.repo
      .createQueryBuilder('t')
      .innerJoin('clients', 'c', 'c.id = t.client_id')
      .select('t.client_id', 'clientId')
      .addSelect('c.razon_social', 'cliente')
      .addSelect('COUNT(*)', 'total');
    applyWithoutSystem(qb);
    const rows: Array<{ clientId: string | number; cliente: string; total: string | number }> = await qb
      .groupBy('t.client_id')
      .addGroupBy('c.razon_social')
      .orderBy('total', 'DESC')
      .getRawMany();
    return rows.map((r) => ({ clientId: Number(r.clientId), cliente: r.cliente, total: Number(r.total) }));
  }

  findById(id: number): Promise<Ticket | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Códigos de varios tickets en una sola consulta (sin repetir ids ni traer columnas de más). */
  async findCodesByIds(ids: number[]): Promise<Map<number, string | null>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.repo.find({ where: { id: In(unique) }, select: ['id', 'code'] });
    return new Map(rows.map((t) => [Number(t.id), t.code ?? null]));
  }

  findByCode(code: string): Promise<Ticket | null> {
    return this.repo.findOne({ where: { code } });
  }

  /**
   * Ticket cuya lista labels (columna JSON) contiene exactamente esa
   * etiqueta (la más reciente si hay varias, p. ej. tras reemplazar un ticket cerrado): JSON_CONTAINS compara elementos completos, así que
   * monitoreo:incidente:1 no encuentra monitoreo:incidente:12.
   */
  findByLabel(label: string): Promise<Ticket | null> {
    return this.repo
      .createQueryBuilder('t')
      .where('JSON_CONTAINS(t.labels, :label)', { label: JSON.stringify(label) })
      .orderBy('t.id', 'DESC')
      .getOne();
  }

  create(data: Partial<Ticket>): Promise<Ticket> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<Ticket>): Promise<Ticket | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }

  /**
   * Firma heredada del repositorio de client_requests: la consume
   * reports.service.ts para el informe mensual de atención.
   */
  listByClientAndRange(params: { clientId: number; from: Date; to: Date }): Promise<Ticket[]> {
    return this.repo
      .createQueryBuilder('t')
      .where('t.client_id = :c', { c: params.clientId })
      .andWhere('t.created_at >= :from', { from: params.from })
      .andWhere('t.created_at < :to', { to: params.to })
      .orderBy('t.service_category', 'ASC')
      .addOrderBy('t.created_at', 'DESC')
      .getMany();
  }

  /**
   * Cuántos tickets apuntan a una asignación cliente-sistema, en cualquier
   * estado (archivados y cerrados incluidos: son histórico igual).
   *
   * El nombre dice de qué id habla: `tickets.system_id` apunta a
   * `client_systems.id`, no al producto del catálogo (decisión 2 del diseño), y
   * confundirlos aquí dejaría borrar una asignación con tickets detrás.
   */
  countByClientSystem(clientSystemId: number): Promise<number> {
    return this.repo.count({ where: { systemId: clientSystemId } });
  }

  /** Carga por técnico: cuántos tickets abiertos tiene asignados cada uno. */
  async countOpenByAssignee(): Promise<Map<number, number>> {
    const rows = await this.repo
      .createQueryBuilder('t')
      .select('t.assignee_user_id', 'userId')
      .addSelect('COUNT(*)', 'total')
      .where('t.status IN (:...open)', { open: OPEN_STATUSES })
      .andWhere('t.assignee_user_id IS NOT NULL')
      .groupBy('t.assignee_user_id')
      .getRawMany<{ userId: string; total: string }>();

    return new Map(rows.map((r) => [Number(r.userId), Number(r.total)]));
  }

  /** Candidatos del job de riesgo: abiertos, no pausados y con plazo definido. */
  listOpenForRiskScan(): Promise<Ticket[]> {
    return this.repo.find({
      where: {
        status: In(OPEN_STATUSES),
        pausedAt: IsNull(),
        slaAtRisk: 0,
      },
    });
  }

  /**
   * Los tickets que esa empresa abrió dentro del periodo, para el informe
   * mensual del portal.
   *
   * Método propio y no `list(filters)`: aquel monta el filtro de empresa con
   * `if (filters.clientId)`, así que un valor falsy haría desaparecer el
   * WHERE y devolvería tickets de todas las empresas. Aquí el `where` es
   * fijo, sin condicional.
   *
   * Intervalo `[from, to)`, abierto por arriba: con `Between` (inclusivo por
   * los dos extremos) un ticket creado en el primer instante de septiembre
   * saldría en el informe de agosto **y** en el de septiembre.
   */
  listForClientPeriod(clientId: number, from: Date, to: Date): Promise<Ticket[]> {
    return this.repo.find({
      // El informe es para el cliente: los tickets internos (monitoreo) no
      // cuentan ahí, igual que no salen en su listado.
      where: { clientId, origin: Not(In(INTERNAL_TICKET_ORIGINS)), capturedAt: And(MoreThanOrEqual(from), LessThan(to)) },
      order: { capturedAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * Cuántos tickets de esa empresa se resolvieron dentro del periodo.
   *
   * Cuenta por `resolvedAt`, no por `capturedAt`: son criterios distintos a
   * propósito. Un ticket abierto en julio y resuelto en agosto cuenta en el
   * informe de agosto, no en el de julio. Mismo `where` fijo y mismo
   * intervalo `[from, to)` que `listForClientPeriod`.
   */
  countResolvedInPeriod(clientId: number, from: Date, to: Date): Promise<number> {
    return this.repo.count({
      // Mismo criterio que `listForClientPeriod`: sin tickets internos.
      where: { clientId, origin: Not(In(INTERNAL_TICKET_ORIGINS)), resolvedAt: And(MoreThanOrEqual(from), LessThan(to)) },
    });
  }
}

/**
 * Pendientes de clasificar: sin sistema, abiertos, no archivados, de origen no
 * interno y de un cliente con al menos un sistema activo (si no tiene ninguno,
 * no hay nada que elegir: eso lo avisa «clientes sin sistemas»).
 */
function applyWithoutSystem(qb: SelectQueryBuilder<Ticket>): void {
  qb.andWhere('t.system_id IS NULL')
    .andWhere("t.status NOT IN ('RESUELTO', 'CERRADO')")
    .andWhere('t.archived_at IS NULL')
    .andWhere('t.origin NOT IN (:...sinSistemaInternos)', { sinSistemaInternos: INTERNAL_TICKET_ORIGINS })
    .andWhere('EXISTS (SELECT 1 FROM client_systems cs WHERE cs.client_id = t.client_id AND cs.is_active = 1)');
}
