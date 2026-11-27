import { All, BadRequestException, Controller, Get, HttpException, HttpStatus, Param, Query, Req, UseGuards } from '@nestjs/common';

import { ApiKeyGuard, IntegrationRequest } from './api-key.guard';
import { parseListQuery } from './domain/list-query';
import { RequerimientoApiView, SistemaApiView, TicketApiDetail, TicketApiView } from './domain/views';
import { parseMonthRange, ResumenApi } from './domain/summary';
import { IntegrationQueryService, Page, REQUIREMENT_FILTERS, TICKET_FILTERS } from './integration-query.service';
import { IntegrationSummaryService } from './integration-summary.service';

/** El cliente sale de la clave; la guarda ya lo dejó en la petición. */
const clientOf = (req: IntegrationRequest): number => req.integration!.clientId;

/**
 * API de integración de solo lectura (`/api/v1/integracion`). Spec:
 * 2026-11-27-api-integracion-clientes-design.md.
 */
@Controller('integracion')
@UseGuards(ApiKeyGuard)
export class IntegrationController {
  constructor(
    private readonly query: IntegrationQueryService,
    private readonly summary: IntegrationSummaryService,
  ) {}

  /** Métricas por mes (Perú) con el cálculo del informe mensual. `desde`/`hasta` en YYYY-MM. */
  @Get('resumen')
  resumen(@Req() req: IntegrationRequest, @Query() q: Record<string, unknown>): Promise<ResumenApi> {
    const extra = Object.keys(q).filter((k) => !['desde', 'hasta', 'formato'].includes(k));
    if (extra.length) throw new BadRequestException({ code: 'BAD_INPUT', message: `Parámetros no admitidos: ${extra.join(', ')}` });
    const one = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : q[k] === undefined ? undefined : '#');
    return this.summary.resumen(clientOf(req), parseMonthRange(one('desde'), one('hasta'), new Date()));
  }

  @Get('sistemas')
  sistemas(@Req() req: IntegrationRequest): Promise<SistemaApiView[]> {
    return this.query.sistemas(clientOf(req));
  }

  @Get('tickets')
  tickets(@Req() req: IntegrationRequest, @Query() q: Record<string, unknown>): Promise<Page<TicketApiView>> {
    return this.query.tickets(clientOf(req), parseListQuery(q, { ...TICKET_FILTERS, csv: false }));
  }

  @Get('tickets/:codigo')
  ticket(@Req() req: IntegrationRequest, @Param('codigo') codigo: string): Promise<TicketApiDetail> {
    return this.query.ticket(clientOf(req), codigo);
  }

  @Get('requerimientos')
  requerimientos(@Req() req: IntegrationRequest, @Query() q: Record<string, unknown>): Promise<Page<RequerimientoApiView>> {
    return this.query.requerimientos(clientOf(req), parseListQuery(q, { ...REQUIREMENT_FILTERS, csv: false }));
  }

  @Get('requerimientos/:codigo')
  requerimiento(@Req() req: IntegrationRequest, @Param('codigo') codigo: string): Promise<RequerimientoApiView> {
    return this.query.requerimiento(clientOf(req), codigo);
  }

  /** Solo lectura: cualquier otro método sobre la API responde 405. */
  @All('*')
  notAllowed(): never {
    throw new HttpException({ code: 'METHOD_NOT_ALLOWED', message: 'La API de integración es de solo lectura (GET).' }, HttpStatus.METHOD_NOT_ALLOWED);
  }
}
