import { All, BadRequestException, Controller, Get, HttpException, HttpStatus, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';

import { ApiKeyGuard, IntegrationRequest } from './api-key.guard';
import {
  requerimientoCsvHeader,
  requerimientoCsvRow,
  resumenCsvHeader,
  resumenCsvRows,
  ticketCsvHeader,
  ticketCsvRow,
  toCsvBody,
} from './domain/csv-views';
import { parseListQuery } from './domain/list-query';
import { parseMonthRange, ResumenApi } from './domain/summary';
import { RequerimientoApiView, SistemaApiView, TicketApiDetail, TicketApiView } from './domain/views';
import { IntegrationQueryService, Page, REQUIREMENT_FILTERS, TICKET_FILTERS } from './integration-query.service';
import { IntegrationSummaryService } from './integration-summary.service';

/** El cliente sale de la clave; la guarda ya lo dejó en la petición. */
const clientOf = (req: IntegrationRequest): number => req.integration!.clientId;

/** `formato` = json (por defecto) o csv; cualquier otro valor es un 400. */
function wantsCsv(q: Record<string, unknown>): boolean {
  const f = q.formato;
  if (f === undefined || f === '' || f === 'json') return false;
  if (f === 'csv') return true;
  throw new BadRequestException({ code: 'BAD_INPUT', message: '«formato» admite json o csv' });
}

/** Cabeceras de una descarga CSV; el cursor de la página siguiente viaja en `X-Siguiente-Cursor`. */
function sendCsv(res: Response, filename: string, body: string, nextCursor: string | null = null): string {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (nextCursor) res.setHeader('X-Siguiente-Cursor', nextCursor);
  res.setHeader('Access-Control-Expose-Headers', 'X-Siguiente-Cursor');
  return body;
}

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
  async resumen(
    @Req() req: IntegrationRequest,
    @Query() q: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ResumenApi | string> {
    const extra = Object.keys(q).filter((k) => !['desde', 'hasta', 'formato'].includes(k));
    if (extra.length) throw new BadRequestException({ code: 'BAD_INPUT', message: `Parámetros no admitidos: ${extra.join(', ')}` });
    const csv = wantsCsv(q);
    const one = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : q[k] === undefined ? undefined : '#');
    const r = await this.summary.resumen(clientOf(req), parseMonthRange(one('desde'), one('hasta'), new Date()));
    return csv ? sendCsv(res, 'resumen.csv', toCsvBody(resumenCsvHeader, resumenCsvRows(r))) : r;
  }

  @Get('sistemas')
  sistemas(@Req() req: IntegrationRequest): Promise<SistemaApiView[]> {
    return this.query.sistemas(clientOf(req));
  }

  @Get('tickets')
  async tickets(
    @Req() req: IntegrationRequest,
    @Query() q: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Page<TicketApiView> | string> {
    const csv = wantsCsv(q);
    const page = await this.query.tickets(clientOf(req), parseListQuery(q, { ...TICKET_FILTERS, csv }));
    return csv ? sendCsv(res, 'tickets.csv', toCsvBody(ticketCsvHeader, page.datos.map(ticketCsvRow)), page.siguienteCursor) : page;
  }

  @Get('tickets/:codigo')
  ticket(@Req() req: IntegrationRequest, @Param('codigo') codigo: string): Promise<TicketApiDetail> {
    return this.query.ticket(clientOf(req), codigo);
  }

  @Get('requerimientos')
  async requerimientos(
    @Req() req: IntegrationRequest,
    @Query() q: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Page<RequerimientoApiView> | string> {
    const csv = wantsCsv(q);
    const page = await this.query.requerimientos(clientOf(req), parseListQuery(q, { ...REQUIREMENT_FILTERS, csv }));
    return csv
      ? sendCsv(res, 'requerimientos.csv', toCsvBody(requerimientoCsvHeader, page.datos.map(requerimientoCsvRow)), page.siguienteCursor)
      : page;
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
