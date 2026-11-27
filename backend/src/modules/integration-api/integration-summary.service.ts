import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { peruMonthBounds } from '../../common/peru-month';
import { buildMonthlyReport } from '../portal/domain/monthly-report';
import { toReportRequirementRow, toReportTicketRow } from '../portal/portal-reports.service';
import { INTERNAL_TICKET_ORIGINS, Ticket } from '../tickets/entities/ticket.entity';
import { TicketsRepository } from '../tickets/tickets.repository';
import { WorkItemsRepository } from '../work-items/work-items.repository';
import { buildMonthEntry, MesResumen, ResumenApi, YearMonth } from './domain/summary';

/** Estados que ya no cuentan como abiertos. */
const CLOSED_TICKET_STATUSES = ['RESUELTO', 'CERRADO'];

/**
 * Resumen para dashboards. Cada mes se calcula con `buildMonthlyReport`, el
 * mismo cálculo del informe mensual del portal: el cliente ve iguales cifras
 * de SLA en la API y en el informe.
 */
@Injectable()
export class IntegrationSummaryService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly workItems: WorkItemsRepository,
    @InjectRepository(Ticket) private readonly ticketRepo: Repository<Ticket>,
  ) {}

  async resumen(clientId: number, months: YearMonth[]): Promise<ResumenApi> {
    const meses: MesResumen[] = [];
    for (const ym of months) meses.push(await this.month(clientId, ym));
    return { abiertos: await this.abiertos(clientId), meses };
  }

  private async month(clientId: number, ym: YearMonth): Promise<MesResumen> {
    const { from, to } = peruMonthBounds(ym.year, ym.month);
    const ticketRows = (await this.tickets.listForClientPeriod(clientId, from, to)).map(toReportTicketRow);
    const body = buildMonthlyReport({
      periodStart: from,
      periodEnd: to,
      tickets: ticketRows,
      ticketsResolvedInPeriod: await this.tickets.countResolvedInPeriod(clientId, from, to),
      requirements: (await this.workItems.listPortalRequirementsInPeriod(clientId, from, to)).map(toReportRequirementRow),
    });
    return buildMonthEntry(ym, body, ticketRows);
  }

  private async abiertos(clientId: number): Promise<ResumenApi['abiertos']> {
    const rows: Array<{ status: string; priority: string; n: string | number }> = await this.ticketRepo
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('t.priority', 'priority')
      .addSelect('COUNT(*)', 'n')
      .where('t.client_id = :clientId', { clientId })
      .andWhere('t.origin NOT IN (:...internal)', { internal: INTERNAL_TICKET_ORIGINS })
      .andWhere('t.status NOT IN (:...closed)', { closed: CLOSED_TICKET_STATUSES })
      .groupBy('t.status')
      .addGroupBy('t.priority')
      .getRawMany();
    const porEstado: Record<string, number> = {};
    const porPrioridad: Record<string, number> = {};
    for (const r of rows) {
      porEstado[r.status] = (porEstado[r.status] ?? 0) + Number(r.n);
      porPrioridad[r.priority] = (porPrioridad[r.priority] ?? 0) + Number(r.n);
    }
    return { porEstado, porPrioridad };
  }
}
