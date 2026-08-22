import { PERU_TIME_ZONE } from '../../../common/time-zone';

/**
 * Tres valores, no dos.
 *
 * `SIN_COMPROMISO` no es un adorno: es la diferencia entre «no cumplimos» y
 * «no habíamos prometido nada». Colapsarlo en cualquiera de los otros dos
 * miente, y es la forma que toma en este informe el defecto que más veces ha
 * reaparecido en el proyecto: decidir por la ausencia de un valor en lugar de
 * por el hecho que lo determina.
 */
export type Compliance = 'CUMPLIDO' | 'INCUMPLIDO' | 'SIN_COMPROMISO';

/**
 * Veredicto sobre un plazo con hora — los dos del SLA de un ticket.
 *
 * `dueAt` ya viene con las pausas absorbidas: `SlaService` desplaza el
 * vencimiento al reanudar un ticket que estuvo en espera del cliente. Restar
 * aquí el tiempo en pausa lo descontaría dos veces.
 *
 * `periodEnd` existe para juzgar lo que quedó sin hacer: en un mes ya cerrado
 * no hay «pendiente de juicio». Si el plazo venció y nadie lo atendió, es
 * incumplido, y da igual que se atienda mañana.
 */
export function judgeDeadline(
  dueAt: Date | null,
  doneAt: Date | null,
  periodEnd: Date,
): Compliance {
  if (!dueAt) return 'SIN_COMPROMISO';
  if (doneAt) return doneAt.getTime() <= dueAt.getTime() ? 'CUMPLIDO' : 'INCUMPLIDO';
  return dueAt.getTime() < periodEnd.getTime() ? 'INCUMPLIDO' : 'SIN_COMPROMISO';
}

/** Fecha civil `YYYY-MM-DD` de un instante, en hora de Perú. */
function peruCivilDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PERU_TIME_ZONE }).format(instant);
}

/**
 * Veredicto sobre una fecha comprometida — la de un requerimiento.
 *
 * Se compara **por fecha civil y no por instante**, porque lo que se le
 * prometió al cliente fue un día entero: entregar a las 22:00 de ese día
 * cumple. Comparar instantes convertiría la promesa en «antes de medianoche
 * UTC», que son las 19:00 en Lima y nadie prometió eso.
 */
export function judgeCommitment(
  committedDate: string | null,
  deliveredAt: Date | null,
  periodEnd: Date,
): Compliance {
  if (!committedDate) return 'SIN_COMPROMISO';
  if (deliveredAt) {
    return peruCivilDate(deliveredAt) <= committedDate ? 'CUMPLIDO' : 'INCUMPLIDO';
  }
  return committedDate < peruCivilDate(periodEnd) ? 'INCUMPLIDO' : 'SIN_COMPROMISO';
}

/**
 * Porcentaje de cumplimiento, o `null` si no hubo nada que medir.
 *
 * Los `SIN_COMPROMISO` **se excluyen del denominador**. Meterlos abajo
 * castigaría al proveedor por trabajo sobre el que nunca se pactó un plazo, y
 * el número dejaría de significar lo que su etiqueta dice.
 *
 * Devuelve `null` y no `0` cuando no hay denominador: un cero se lee como «no
 * cumplieron nada», y lo cierto es «no había nada que cumplir». Quien pinte
 * esto debe escribir un guion, no un número.
 */
export function compliancePercent(items: Compliance[]): number | null {
  const medibles = items.filter((c) => c !== 'SIN_COMPROMISO');
  if (medibles.length === 0) return null;
  const cumplidos = medibles.filter((c) => c === 'CUMPLIDO').length;
  return Math.round((cumplidos / medibles.length) * 100);
}

/** Una fila de ticket, tal como la necesita el informe: ya resuelta la vista, sin el resto de la entidad. */
export interface ReportTicketRow {
  id: number;
  code: string | null;
  subject: string | null;
  category: string | null;
  priority: string;
  status: string;
  capturedAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  slaResponseDueAt: Date | null;
  slaResolutionDueAt: Date | null;
}

/** Una fila de requerimiento, tal como la necesita el informe. */
export interface ReportRequirementRow {
  id: number;
  code: string | null;
  title: string;
  status: string;
  createdAt: Date;
  dueDate: string | null;
  closedAt: Date | null;
}

/**
 * Lo que hace falta para calcular el informe de un periodo.
 *
 * `tickets` y `requirements` son `null` cuando ese bloque no se pidió, no
 * cuando salió vacío: la ausencia de la lista y una lista vacía significan
 * cosas distintas y esa diferencia se preserva en la salida.
 */
export interface BuildReportInput {
  periodStart: Date;
  periodEnd: Date;
  tickets: ReportTicketRow[] | null;
  ticketsResolvedInPeriod: number | null;
  requirements: ReportRequirementRow[] | null;
}

/** Una fila de ticket ya con sus dos veredictos de SLA calculados. */
export interface ReportTicketRowWithCompliance extends ReportTicketRow {
  responseCompliance: Compliance;
  resolutionCompliance: Compliance;
}

/** Totales del bloque de tickets. */
export interface TicketsTotals {
  received: number;
  resolved: number;
  pending: number;
  /** Distinta de `resolved`: esta cuenta tickets resueltos en el periodo aunque se hayan recibido antes. */
  resolvedInPeriod: number;
  responseCompliancePercent: number | null;
  resolutionCompliancePercent: number | null;
  withoutCommitment: number;
}

export interface TicketsBlock {
  rows: ReportTicketRowWithCompliance[];
  totals: TicketsTotals;
}

/** Una fila de requerimiento ya con su veredicto de compromiso calculado. */
export interface ReportRequirementRowWithCompliance extends ReportRequirementRow {
  commitment: Compliance;
}

/** Totales del bloque de requerimientos. */
export interface RequirementsTotals {
  requested: number;
  accepted: number;
  delivered: number;
  rejected: number;
  commitmentCompliancePercent: number | null;
}

export interface RequirementsBlock {
  rows: ReportRequirementRowWithCompliance[];
  totals: RequirementsTotals;
}

/**
 * Cuerpo calculado del informe mensual.
 *
 * Cada bloque es `null` cuando no se pidió, y nunca un bloque con listas y
 * totales vacíos: esa diferencia («no lo pediste» vs. «no hubo nada») tiene
 * que sobrevivir hasta el documento que ve el cliente.
 */
export interface MonthlyReportBody {
  tickets: TicketsBlock | null;
  requirements: RequirementsBlock | null;
}

/** Estados que cuentan como resuelto en el modelo de tickets. */
const TICKET_RESUELTO = new Set(['RESUELTO', 'CERRADO']);

/** Un requerimiento aceptado es el que ya salió de SOLICITADO sin ser rechazado. */
const REQ_NO_ACEPTADO = new Set(['SOLICITADO', 'RECHAZADO']);

function buildTicketsBlock(input: BuildReportInput): TicketsBlock {
  const rows: ReportTicketRowWithCompliance[] = (input.tickets ?? []).map((t) => ({
    ...t,
    responseCompliance: judgeDeadline(t.slaResponseDueAt, t.firstResponseAt, input.periodEnd),
    resolutionCompliance: judgeDeadline(t.slaResolutionDueAt, t.resolvedAt, input.periodEnd),
  }));

  const resolved = rows.filter((r) => TICKET_RESUELTO.has(r.status)).length;

  return {
    rows,
    totals: {
      received: rows.length,
      resolved,
      pending: rows.length - resolved,
      // `ticketsResolvedInPeriod` es una cuenta aparte, calculada fuera de este
      // módulo puro (requiere consultar por fecha de resolución dentro del
      // periodo, no por pertenencia de la fila al periodo). `?? 0` es correcto
      // aquí porque quien construye el input decide explícitamente pedir o no
      // el bloque: si pide tickets, siempre calcula este número.
      resolvedInPeriod: input.ticketsResolvedInPeriod ?? 0,
      responseCompliancePercent: compliancePercent(rows.map((r) => r.responseCompliance)),
      resolutionCompliancePercent: compliancePercent(rows.map((r) => r.resolutionCompliance)),
      withoutCommitment: rows.filter((r) => r.resolutionCompliance === 'SIN_COMPROMISO').length,
    },
  };
}

function buildRequirementsBlock(input: BuildReportInput): RequirementsBlock {
  const rows: ReportRequirementRowWithCompliance[] = (input.requirements ?? []).map((r) => ({
    ...r,
    commitment: judgeCommitment(r.dueDate, r.closedAt, input.periodEnd),
  }));

  return {
    rows,
    totals: {
      requested: rows.length,
      accepted: rows.filter((r) => !REQ_NO_ACEPTADO.has(r.status)).length,
      delivered: rows.filter((r) => r.status === 'CERRADO').length,
      rejected: rows.filter((r) => r.status === 'RECHAZADO').length,
      commitmentCompliancePercent: compliancePercent(rows.map((r) => r.commitment)),
    },
  };
}

/**
 * Calcula el cuerpo del informe mensual a partir de los datos ya leídos.
 *
 * Módulo puro: no consulta nada, solo transforma lo que le dan. Quien lo
 * llama decide qué bloques pedir pasando `null` o una lista.
 */
export function buildMonthlyReport(input: BuildReportInput): MonthlyReportBody {
  return {
    // `null` y no un bloque vacío: «no lo pediste» y «no hubo nada» son cosas
    // distintas, y quien dibuje el documento tiene que poder distinguirlas.
    tickets: input.tickets === null ? null : buildTicketsBlock(input),
    requirements: input.requirements === null ? null : buildRequirementsBlock(input),
  };
}
