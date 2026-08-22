import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { peruMonthBounds, isPeruMonthClosed } from '../../common/peru-month';
import { PERU_TIME_ZONE } from '../../common/time-zone';
import { TicketsRepository } from '../tickets/tickets.repository';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TICKET_STATUS_LABELS } from '../tickets/domain/ticket-state-machine';
import { WorkItemsRepository } from '../work-items/work-items.repository';
import { WorkItem } from '../work-items/entities/work-item.entity';
import { ClientsService } from '../clients/clients.service';

import {
  buildMonthlyReport,
  ReportRequirementRow,
  ReportRequirementRowWithCompliance,
  ReportTicketRow,
  ReportTicketRowWithCompliance,
} from './domain/monthly-report';
import { REQUIREMENT_STATUS_LABELS } from './domain/requirement-status-labels';
import { assertSessionScope, toIso } from './session-scope';
import {
  MonthlyReportQueryDto,
  MonthlyReportRequirementRow,
  MonthlyReportTicketRow,
  MonthlyReportView,
  ReportScope,
} from './dto/monthly-report.dto';

/** Formatea una fecha en texto largo y en español, en hora de Perú — para el criterio impreso, no para ordenar ni comparar. */
function formatPeruDate(instant: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: PERU_TIME_ZONE,
  }).format(instant);
}

/**
 * Lista blanca campo a campo hacia el módulo de cálculo. Nunca `{...t}`: por
 * ahí saldrían `rootCause`, `correctiveAction`, `resolutionMd` o
 * `assigneeUserId` hacia un módulo cuyo resultado, tarde o temprano, ve el
 * cliente.
 *
 * El `status` que viaja aquí es el crudo del enum, no el traducido: es el que
 * `buildMonthlyReport` necesita para decidir "resuelto" (`TICKET_RESUELTO`).
 * La traducción a lo que lee el cliente pasa después, en `toReportTicketView`.
 */
function toReportTicketRow(t: Ticket): ReportTicketRow {
  return {
    id: Number(t.id),
    code: t.code,
    subject: t.subject,
    category: t.serviceCategory,
    priority: t.priority,
    status: t.status,
    capturedAt: t.capturedAt,
    firstResponseAt: t.firstResponseAt,
    resolvedAt: t.resolvedAt,
    slaResponseDueAt: t.slaResponseDueAt,
    slaResolutionDueAt: t.slaResolutionDueAt,
  };
}

/** Misma disciplina que `toReportTicketRow`: lista blanca, estado crudo hasta después de calcular. */
function toReportRequirementRow(w: WorkItem): ReportRequirementRow {
  return {
    id: Number(w.id),
    code: w.code,
    title: w.title,
    status: w.status,
    createdAt: w.createdAt,
    dueDate: w.dueDate,
    closedAt: w.closedAt,
  };
}

/**
 * Del resultado ya calculado a lo que ve el cliente: fechas en ISO y estado
 * traducido con `TICKET_STATUS_LABELS`. Este documento acaba en un PDF que lee
 * alguien ajeno a la casa, y un `EN_ATENCION` en mayúsculas con guion bajo no
 * es algo que se le enseñe a un cliente.
 */
function toTicketView(r: ReportTicketRowWithCompliance): MonthlyReportTicketRow {
  return {
    id: r.id,
    code: r.code,
    subject: r.subject,
    category: r.category,
    priority: r.priority,
    status: TICKET_STATUS_LABELS[r.status as keyof typeof TICKET_STATUS_LABELS],
    capturedAt: toIso(r.capturedAt)!,
    firstResponseAt: toIso(r.firstResponseAt),
    resolvedAt: toIso(r.resolvedAt),
    slaResponseDueAt: toIso(r.slaResponseDueAt),
    slaResolutionDueAt: toIso(r.slaResolutionDueAt),
    responseCompliance: r.responseCompliance,
    resolutionCompliance: r.resolutionCompliance,
  };
}

/** Misma disciplina que `toTicketView`, con `REQUIREMENT_STATUS_LABELS`. */
function toRequirementView(r: ReportRequirementRowWithCompliance): MonthlyReportRequirementRow {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    status: REQUIREMENT_STATUS_LABELS[r.status as keyof typeof REQUIREMENT_STATUS_LABELS],
    createdAt: toIso(r.createdAt)!,
    dueDate: r.dueDate,
    closedAt: toIso(r.closedAt),
    commitment: r.commitment,
  };
}

/**
 * El texto que hace explicable el documento: qué se contó y desde cuándo, y
 * —el punto que pidió expresamente la revisión del cálculo (`monthly-report.ts`,
 * JSDoc de `buildMonthlyReport`)— que los veredictos de cumplimiento reflejan
 * el estado *actual* de cada fila, no una foto fija del cierre del periodo.
 * Sin esta frase, dos descargas del mismo mes con números distintos —porque
 * un ticket se resolvió después de cerrado el periodo— no se pueden explicar,
 * y el informe genera llamadas en vez de evitarlas.
 */
function buildCriteria(scope: ReportScope, from: Date, to: Date): string {
  // `to` es exclusivo: el último día del periodo es el instante anterior.
  const desde = formatPeruDate(from);
  const hasta = formatPeruDate(new Date(to.getTime() - 1));

  const queCuenta =
    scope === 'TICKETS'
      ? 'Tickets creados'
      : scope === 'REQUERIMIENTOS'
        ? 'Requerimientos creados'
        : 'Tickets y requerimientos creados';

  const notaResueltos =
    scope === 'REQUERIMIENTOS'
      ? ''
      : ' «Resueltos dentro del periodo» cuenta los resueltos en esas fechas, se hayan creado cuando fuera.';

  return (
    `${queCuenta} entre el ${desde} y el ${hasta}, hora de Perú.${notaResueltos} ` +
    'Los veredictos de cumplimiento de plazos reflejan el estado actual de cada fila, no una foto ' +
    'fija del cierre del periodo: algo resuelto o entregado después de que el mes cerró puede figurar ' +
    'como cumplido si el informe se vuelve a descargar más tarde.'
  );
}

@Injectable()
export class PortalReportsService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly workItems: WorkItemsRepository,
    private readonly clients: ClientsService,
  ) {}

  async monthly(clientId: number, dto: MonthlyReportQueryDto): Promise<MonthlyReportView> {
    assertSessionScope(clientId, 'clientId', PortalReportsService.name);

    const ahora = new Date();
    if (!isPeruMonthClosed(dto.year, dto.month, ahora)) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Solo se puede descargar el informe de un mes que ya terminó.',
      });
    }

    const { from, to } = peruMonthBounds(dto.year, dto.month);
    const quiereTickets = dto.scope === 'TICKETS' || dto.scope === 'AMBOS';
    const quiereReqs = dto.scope === 'REQUERIMIENTOS' || dto.scope === 'AMBOS';

    // El bloque que no se pidió ni se consulta: no es una optimización, es
    // que el informe no debe leer datos que nadie pidió. `null` viaja hasta
    // el documento para que «no lo pediste» no se confunda con «no hubo
    // nada».
    //
    // `tickets`/`ticketsResolvedInPeriod` se arman juntos, en la misma rama,
    // para que su tipo caiga solo en la unión discriminada de
    // `BuildReportInput`: el compilador no deja pasar "pedí tickets pero no
    // calculé cuántos se resolvieron" (ni falta un `as` para forzarlo).
    const ticketsInput = quiereTickets
      ? {
          tickets: (await this.tickets.listForClientPeriod(clientId, from, to)).map(toReportTicketRow),
          ticketsResolvedInPeriod: await this.tickets.countResolvedInPeriod(clientId, from, to),
        }
      : { tickets: null, ticketsResolvedInPeriod: null };

    const requirementRows = quiereReqs
      ? await this.workItems.listPortalRequirementsInPeriod(clientId, from, to)
      : null;

    const body = buildMonthlyReport({
      periodStart: from,
      periodEnd: to,
      requirements: requirementRows && requirementRows.map(toReportRequirementRow),
      ...ticketsInput,
    });

    return {
      clientName: await this.resolveClientName(clientId),
      period: { year: dto.year, month: dto.month },
      scope: dto.scope,
      generatedAt: toIso(ahora)!,
      criteria: buildCriteria(dto.scope, from, to),
      tickets:
        body.tickets === null
          ? null
          : { rows: body.tickets.rows.map(toTicketView), totals: body.tickets.totals },
      requirements:
        body.requirements === null
          ? null
          : { rows: body.requirements.rows.map(toRequirementView), totals: body.requirements.totals },
    };
  }

  /**
   * Proyección campo por campo, mismo criterio que
   * `PortalAuthService.resolveClientRazonSocial`: se pide el cliente completo
   * y se extrae solo la razón social, nunca RUC, dirección ni datos de
   * facturación. Un cliente que ya no existe degrada a `null`; cualquier otro
   * fallo sigue subiendo tal cual.
   */
  private async resolveClientName(clientId: number): Promise<string | null> {
    try {
      const client = await this.clients.findByIdOrFail(clientId);
      return client.razonSocial;
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }
}
