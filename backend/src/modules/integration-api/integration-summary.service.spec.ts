import { peruMonthBounds } from '../../common/peru-month';
import { buildMonthlyReport } from '../portal/domain/monthly-report';
import { toReportRequirementRow, toReportTicketRow } from '../portal/portal-reports.service';
import { IntegrationSummaryService } from './integration-summary.service';

const ticket = (over: Record<string, unknown>) => ({
  id: 1, code: 'KB-1', subject: 's', serviceCategory: null, priority: 'P2', status: 'RESUELTO',
  capturedAt: new Date('2026-10-05T15:00:00Z'), firstResponseAt: new Date('2026-10-05T16:00:00Z'),
  resolvedAt: new Date('2026-10-06T15:00:00Z'), slaResponseDueAt: new Date('2026-10-05T17:00:00Z'),
  slaResolutionDueAt: new Date('2026-10-06T10:00:00Z'), origin: 'PORTAL', ...over,
});

describe('IntegrationSummaryService', () => {
  it('las cifras de un mes coinciden con las del informe mensual para los mismos datos', async () => {
    const tickets = [ticket({}), ticket({ id: 2, code: 'KB-2', resolvedAt: null, status: 'EN_ATENCION' })];
    const reqs = [{ id: 3, code: 'RQ-3', title: 't', status: 'CERRADO', createdAt: new Date('2026-10-02T15:00:00Z'), dueDate: '2026-10-20', closedAt: new Date('2026-10-18T15:00:00Z') }];
    const repoT = { listForClientPeriod: jest.fn(async () => tickets), countResolvedInPeriod: jest.fn(async () => 1) };
    const repoW = { listPortalRequirementsInPeriod: jest.fn(async () => reqs) };
    const qb: any = { select: () => qb, addSelect: () => qb, where: () => qb, andWhere: () => qb, groupBy: () => qb, addGroupBy: () => qb, getRawMany: async () => [{ status: 'EN_ATENCION', priority: 'P2', n: '1' }] };
    const svc = new IntegrationSummaryService(repoT as any, repoW as any, { createQueryBuilder: () => qb } as any);

    const r = await svc.resumen(10, [{ year: 2026, month: 10 }]);

    const { from, to } = peruMonthBounds(2026, 10);
    const expected = buildMonthlyReport({
      periodStart: from, periodEnd: to,
      tickets: (tickets as any[]).map(toReportTicketRow), ticketsResolvedInPeriod: 1,
      requirements: (reqs as any[]).map(toReportRequirementRow),
    });
    expect(r.meses[0].mes).toBe('2026-10');
    expect(r.meses[0].tickets.cumplimientoRespuestaPct).toBe(expected.tickets!.totals.responseCompliancePercent);
    expect(r.meses[0].tickets.cumplimientoResolucionPct).toBe(expected.tickets!.totals.resolutionCompliancePercent);
    expect(r.meses[0].requerimientos.cumplimientoCompromisoPct).toBe(expected.requirements!.totals.commitmentCompliancePercent);
    expect(r.meses[0].tickets.resolucionMediaHoras).toBe(24);
    expect(repoT.listForClientPeriod).toHaveBeenCalledWith(10, from, to);
    expect(r.abiertos).toEqual({ porEstado: { EN_ATENCION: 1 }, porPrioridad: { P2: 1 } });
  });
});
