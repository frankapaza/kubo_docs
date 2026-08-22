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
 *
 * `periodEnd` **debe ser exclusivo** — el primer instante fuera del periodo,
 * como lo entrega `peruMonthBounds` — porque aquí se reduce a fecha civil
 * para comparar. Con un `periodEnd` inclusivo el incumplimiento del último
 * día del mes desaparecería del informe. `judgeDeadline` no sufre esto:
 * compara instantes, no fechas civiles.
 *
 * `status` existe por una sola razón: un `CANCELADO` nunca tiene
 * `deliveredAt` (`WorkItemBoardService` solo pone `closedAt` al pasar a
 * `CERRADO`), así que sin esta comprobación caería en la última rama y una
 * fecha comprometida ya pasada lo condenaría a `INCUMPLIDO`. `WorkItemsRepository.list`
 * ya documenta y hace cumplir la misma regla para el filtro «vencidos»: *«Un
 * ítem CERRADO o CANCELADO nunca está vencido […] su fecha límite dejó de
 * significar nada»*. Sin este caso, el informe publicaba como incumplimiento
 * del proveedor la misma fila que el tablero pinta en gris, sin marca de
 * vencido.
 */
export function judgeCommitment(
  committedDate: string | null,
  deliveredAt: Date | null,
  periodEnd: Date,
  status: string,
): Compliance {
  // Comprobación de presencia, no de veracidad: una cadena vacía es un valor
  // inválido, no una ausencia. Con `!committedDate` colapsaría al mismo bug
  // de los textos en blanco que ya mordió este proyecto.
  if (committedDate === null) return 'SIN_COMPROMISO';
  if (deliveredAt) {
    return peruCivilDate(deliveredAt) <= committedDate ? 'CUMPLIDO' : 'INCUMPLIDO';
  }
  if (status === 'CANCELADO') return 'SIN_COMPROMISO';
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

/** Campos del informe que no dependen de qué bloques se pidieron. */
interface BuildReportInputCommon {
  periodStart: Date;
  /** Exclusivo: el primer instante fuera del periodo (ver `peruMonthBounds`). */
  periodEnd: Date;
  requirements: ReportRequirementRow[] | null;
}

/**
 * Lo que hace falta para calcular el informe de un periodo.
 *
 * `tickets`/`requirements` son `null` cuando ese bloque no se pidió, no
 * cuando salió vacío: la ausencia de la lista y una lista vacía significan
 * cosas distintas y esa diferencia se preserva en la salida.
 *
 * `ticketsResolvedInPeriod` viaja pegado a `tickets` en una unión
 * discriminada a propósito: esa cifra se calcula aparte, con otra consulta,
 * y solo tiene sentido pedirla cuando también se pide el bloque de tickets.
 * El tipo no permite expresar «pedí tickets pero no calculé cuántos se
 * resolvieron en el periodo» — no es que ese caso se decida traduciéndolo a
 * `0`, es que no existe como valor posible.
 */
export type BuildReportInput = BuildReportInputCommon &
  (
    | { tickets: ReportTicketRow[]; ticketsResolvedInPeriod: number }
    | { tickets: null; ticketsResolvedInPeriod: null }
  );

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
  /**
   * Tickets **sin ningún SLA de resolución pactado**: no hubo promesa que
   * incumplir. Distinto de `notYetDue` — confundirlos le haría decir al
   * informe que un ticket con un SLA todavía vigente «no tuvo compromiso»,
   * cuando sí lo tiene, solo que aún no venció.
   */
  withoutCommitment: number;
  /**
   * Tickets **con** SLA de resolución pactado, sin resolver, cuyo plazo
   * todavía no había vencido al cerrar el periodo. La otra mitad de
   * `SIN_COMPROMISO`: aquí sí hubo promesa, solo que el juicio sobre si se
   * cumplió o no todavía no correspondía emitirlo.
   */
  notYetDue: number;
  /**
   * Igual que `withoutCommitment`, para el SLA de **respuesta**: tickets sin
   * ningún `slaResponseDueAt` pactado. `responseCompliancePercent` ya excluye
   * estos casos del denominador (ver `compliancePercent`), pero sin esta
   * cifra el documento no dice sobre cuántos se calculó ese porcentaje — y
   * ese número es justo lo que el informe existe para justificar.
   */
  responseWithoutCommitment: number;
  /** Igual que `notYetDue`, para el SLA de respuesta. */
  responseNotYetDue: number;
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
  /**
   * Salieron de `SOLICITADO` sin ser rechazados — **incluye** a los ya
   * `delivered` y a los `CANCELADO` tras haberse aceptado: no es una
   * categoría exclusiva de «entregados» ni desaparece al cancelarse, sino
   * que los contiene a todos. Ver `REQ_ACEPTADO`.
   */
  accepted: number;
  delivered: number;
  rejected: number;
  /**
   * `null` cuando no hubo ningún compromiso medible (todo `SIN_COMPROMISO`).
   * Mismo criterio que `TicketsTotals.resolutionCompliancePercent`: los
   * `withoutCommitment`/`notYetDue` de abajo son las cifras equivalentes que
   * dicen sobre cuántos se calculó.
   */
  commitmentCompliancePercent: number | null;
  /**
   * Requerimientos **sin ninguna fecha comprometida**: no hubo promesa que
   * incumplir. Mismo criterio que `TicketsTotals.withoutCommitment`.
   */
  withoutCommitment: number;
  /**
   * Requerimientos **con** fecha comprometida, sin entregar, cuyo veredicto
   * es `SIN_COMPROMISO` porque el plazo aún no vencía al cerrar el periodo o
   * porque el ítem se canceló (ver `judgeCommitment`, caso `CANCELADO`): en
   * los dos casos no corresponde emitir un juicio de cumplimiento todavía o
   * ya nunca. Mismo criterio que `TicketsTotals.notYetDue`.
   */
  notYetDue: number;
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

/**
 * Los estados que cuentan como «aceptado»: salieron de `SOLICITADO` sin ser
 * rechazados. Se enumeran en positivo, en lugar de descartar por una lista
 * negra: con lista negra, cualquier estado futuro o desconocido —uno que el
 * negocio invente mañana, o un valor corrupto— pasaría a contar como
 * aceptado por el mero hecho de no estar prohibido. Es la forma que toma
 * aquí el defecto que más veces ha reaparecido en este proyecto: decidir por
 * la ausencia de un valor en lugar de por el hecho que lo determina. Ver
 * `WorkItemStatus` en `work-items/domain/work-item-board.ts` para el
 * catálogo vigente de estados.
 */
const REQ_ACEPTADO = new Set(['PENDIENTE', 'EN_PROCESO', 'PRUEBAS', 'CERRADO', 'BLOQUEADO', 'CANCELADO']);

function buildTicketsBlock(
  ticketRows: ReportTicketRow[],
  ticketsResolvedInPeriod: number,
  periodEnd: Date,
): TicketsBlock {
  const rows: ReportTicketRowWithCompliance[] = ticketRows.map((t) => ({
    ...t,
    responseCompliance: judgeDeadline(t.slaResponseDueAt, t.firstResponseAt, periodEnd),
    resolutionCompliance: judgeDeadline(t.slaResolutionDueAt, t.resolvedAt, periodEnd),
  }));

  const resolved = rows.filter((r) => TICKET_RESUELTO.has(r.status)).length;

  // El veredicto SIN_COMPROMISO de cada columna de cumplimiento mezcla dos
  // causas (ver JSDoc de `withoutCommitment`/`notYetDue` en `TicketsTotals`):
  // aquí se separan mirando si hubo o no un SLA pactado para esa columna.
  const sinResolucionMedible = rows.filter((r) => r.resolutionCompliance === 'SIN_COMPROMISO');
  const sinRespuestaMedible = rows.filter((r) => r.responseCompliance === 'SIN_COMPROMISO');

  return {
    rows,
    totals: {
      received: rows.length,
      resolved,
      pending: rows.length - resolved,
      resolvedInPeriod: ticketsResolvedInPeriod,
      responseCompliancePercent: compliancePercent(rows.map((r) => r.responseCompliance)),
      resolutionCompliancePercent: compliancePercent(rows.map((r) => r.resolutionCompliance)),
      withoutCommitment: sinResolucionMedible.filter((r) => r.slaResolutionDueAt === null).length,
      notYetDue: sinResolucionMedible.filter((r) => r.slaResolutionDueAt !== null).length,
      responseWithoutCommitment: sinRespuestaMedible.filter((r) => r.slaResponseDueAt === null).length,
      responseNotYetDue: sinRespuestaMedible.filter((r) => r.slaResponseDueAt !== null).length,
    },
  };
}

function buildRequirementsBlock(
  requirementRows: ReportRequirementRow[],
  periodEnd: Date,
): RequirementsBlock {
  const rows: ReportRequirementRowWithCompliance[] = requirementRows.map((r) => ({
    ...r,
    commitment: judgeCommitment(r.dueDate, r.closedAt, periodEnd, r.status),
  }));

  // Mismo tratamiento que `buildTicketsBlock`: el SIN_COMPROMISO se separa
  // mirando si hubo o no una fecha comprometida pactada.
  const sinCompromisoMedible = rows.filter((r) => r.commitment === 'SIN_COMPROMISO');

  return {
    rows,
    totals: {
      requested: rows.length,
      accepted: rows.filter((r) => REQ_ACEPTADO.has(r.status)).length,
      delivered: rows.filter((r) => r.status === 'CERRADO').length,
      rejected: rows.filter((r) => r.status === 'RECHAZADO').length,
      commitmentCompliancePercent: compliancePercent(rows.map((r) => r.commitment)),
      withoutCommitment: sinCompromisoMedible.filter((r) => r.dueDate === null).length,
      notYetDue: sinCompromisoMedible.filter((r) => r.dueDate !== null).length,
    },
  };
}

/**
 * Calcula el cuerpo del informe mensual a partir de los datos ya leídos.
 *
 * Módulo puro: no consulta nada, solo transforma lo que le dan. Quien lo
 * llama decide qué bloques pedir pasando `null` o una lista.
 *
 * Nota para quien redacte el texto de `criteria` que acompaña al informe
 * (tarea 5): estos veredictos reflejan el estado **actual** de cada fila, no
 * una foto fija del cierre del periodo. Un ticket resuelto después de que el
 * mes cerró entra como `CUMPLIDO` en el informe de ese mes si se vuelve a
 * generar más tarde — es una consecuencia deliberada de que el informe es en
 * vivo y no un histórico reconstruido por eventos, y el texto que lee el
 * cliente debe decirlo.
 */
export function buildMonthlyReport(input: BuildReportInput): MonthlyReportBody {
  return {
    // `null` y no un bloque vacío: «no lo pediste» y «no hubo nada» son cosas
    // distintas, y quien dibuje el documento tiene que poder distinguirlas.
    tickets: input.tickets === null
      ? null
      : buildTicketsBlock(input.tickets, input.ticketsResolvedInPeriod, input.periodEnd),
    requirements: input.requirements === null
      ? null
      : buildRequirementsBlock(input.requirements, input.periodEnd),
  };
}
