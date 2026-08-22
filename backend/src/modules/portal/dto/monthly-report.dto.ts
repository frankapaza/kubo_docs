import { IsIn, IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { Compliance, RequirementsTotals, TicketsTotals } from '../domain/monthly-report';
import { PortalRequirementStatusLabel } from './portal-requirement.dto';

/**
 * Qué bloques trae el informe. `TICKETS` y `REQUERIMIENTOS` no consultan el
 * bloque contrario — ver `PortalReportsService.monthly`, que es donde se hace
 * cumplir, no aquí: este tipo solo nombra las tres formas válidas.
 */
export const REPORT_SCOPES = ['TICKETS', 'REQUERIMIENTOS', 'AMBOS'] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];

/**
 * Query de la descarga. Los mensajes van en español y sin nombres internos de
 * propiedad, porque `portal-validation.integration.spec.ts` lo vigila con dos
 * listas negras (inglés de class-validator y nombres de columna).
 */
export class MonthlyReportQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'El año del informe no es válido.' })
  @Min(2000, { message: 'El año del informe no es válido.' })
  @Max(2100, { message: 'El año del informe no es válido.' })
  year!: number;

  @Type(() => Number)
  @IsInt({ message: 'El mes debe estar entre 1 y 12.' })
  @Min(1, { message: 'El mes debe estar entre 1 y 12.' })
  @Max(12, { message: 'El mes debe estar entre 1 y 12.' })
  month!: number;

  @IsIn(REPORT_SCOPES, { message: 'El alcance debe ser tickets, requerimientos o ambos.' })
  scope!: ReportScope;
}

/**
 * Fila de ticket tal como la ve el cliente: mismas columnas que
 * `ReportTicketRowWithCompliance`, pero con las fechas ya en ISO y el
 * `status` ya traducido con `TICKET_STATUS_LABELS`. El módulo de cálculo
 * necesita el estado crudo para decidir "resuelto"; el documento que lee el
 * cliente no.
 */
export interface MonthlyReportTicketRow {
  id: number;
  code: string | null;
  subject: string | null;
  category: string | null;
  priority: string;
  status: string;
  capturedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  slaResponseDueAt: string | null;
  slaResolutionDueAt: string | null;
  responseCompliance: Compliance;
  resolutionCompliance: Compliance;
}

export interface MonthlyReportTicketsBlock {
  rows: MonthlyReportTicketRow[];
  totals: TicketsTotals;
}

/** Fila de requerimiento tal como la ve el cliente, mismo criterio que `MonthlyReportTicketRow`. */
export interface MonthlyReportRequirementRow {
  id: number;
  code: string | null;
  title: string;
  status: PortalRequirementStatusLabel;
  createdAt: string;
  dueDate: string | null;
  closedAt: string | null;
  commitment: Compliance;
}

export interface MonthlyReportRequirementsBlock {
  rows: MonthlyReportRequirementRow[];
  totals: RequirementsTotals;
}

/**
 * Lo que descarga el cliente. Cada bloque es `null` cuando no se pidió, nunca
 * un bloque con listas y totales vacíos — esa diferencia («no lo pediste» vs.
 * «no hubo nada») viene ya así de `buildMonthlyReport` y se conserva hasta
 * aquí.
 */
export interface MonthlyReportView {
  /** Razón social del cliente, o `null` si no pudo resolverse (ver `./client-name`). */
  clientName: string | null;
  period: { year: number; month: number };
  scope: ReportScope;
  /**
   * ISO del instante en que se generó el documento, para uso de máquina
   * (ordenar, comparar, cachear). Nunca lo que lee la persona: un `Date`
   * formateado sin zona en el navegador del cliente puede salir con otra
   * hora, y hasta otro día — ver `generatedAtLabel`.
   */
  generatedAt: string;
  /**
   * El mismo instante que `generatedAt`, ya en texto legible, en español y
   * con la zona escrita («21 de agosto de 2026 a las 7:42 p. m. (hora de
   * Perú)»). Se formatea aquí, en el backend, y no en quien dibuja el
   * documento: el backend corre con `TZ=UTC` fijo a propósito, y de los
   * formateadores de fecha del frontend casi ninguno pasa `timeZone` — el
   * mismo documento leído en dos máquinas con hora local distinta no debe
   * decir dos fechas de generación distintas.
   */
  generatedAtLabel: string;
  /**
   * Qué se contó y desde cuándo, en texto llano: sin esto, dos descargas del
   * mismo mes con números distintos —porque un veredicto de cumplimiento
   * refleja el estado *actual*, no una foto fija del cierre del periodo— no
   * se pueden explicar y el informe genera llamadas en vez de evitarlas.
   */
  criteria: string;
  tickets: MonthlyReportTicketsBlock | null;
  requirements: MonthlyReportRequirementsBlock | null;
}
