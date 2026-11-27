import { toCsv } from '../../availability/domain/csv';
import { ResumenApi } from './summary';
import { RequerimientoApiView, TicketApiView } from './views';

/** Mismas columnas y en el mismo orden que la vista JSON: quien pasa de JSON a CSV no reaprende nada. */
export const ticketCsvHeader: (keyof TicketApiView)[] = [
  'id', 'codigo', 'asunto', 'descripcion', 'estado', 'prioridad', 'sistemaId', 'sistema', 'creadoEn', 'actualizadoEn',
  'resueltoEn', 'cerradoEn', 'venceRespuesta', 'venceResolucion', 'slaEnRiesgo',
];

export const requerimientoCsvHeader: (keyof RequerimientoApiView)[] = [
  'id', 'codigo', 'titulo', 'descripcion', 'estado', 'estadoCodigo', 'prioridad', 'sistemaId', 'fechaComprometida',
  'cerradoEn', 'creadoEn', 'actualizadoEn', 'motivoRechazo', 'preguntaPendiente', 'tipo',
];

/** null/undefined → vacío; booleano → si/no; el resto, como texto. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'si' : 'no';
  return String(v);
}

export function ticketCsvRow(v: TicketApiView): string[] {
  return ticketCsvHeader.map((k) => cell(v[k]));
}

export function requerimientoCsvRow(v: RequerimientoApiView): string[] {
  return requerimientoCsvHeader.map((k) => cell(v[k]));
}

export const resumenCsvHeader = ['metrica', 'dimension', 'mes', 'valor'];

/** Tabla larga: una fila por métrica, dimensión y mes. Lo cómodo para una tabla dinámica de Excel. */
export function resumenCsvRows(r: ResumenApi): string[][] {
  const rows: string[][] = [];
  for (const [estado, n] of Object.entries(r.abiertos.porEstado)) rows.push(['tickets_abiertos', `estado:${estado}`, '', String(n)]);
  for (const [p, n] of Object.entries(r.abiertos.porPrioridad)) rows.push(['tickets_abiertos', `prioridad:${p}`, '', String(n)]);
  for (const m of r.meses) {
    for (const [k, v] of Object.entries(m.tickets)) rows.push([`tickets.${k}`, '', m.mes, cell(v)]);
    for (const [k, v] of Object.entries(m.requerimientos)) rows.push([`requerimientos.${k}`, '', m.mes, cell(v)]);
  }
  return rows;
}

/** CSV UTF-8 con BOM, `;` y CRLF, con las celdas a prueba de fórmulas (mismo escape que el monitoreo). */
export function toCsvBody(header: string[], rows: string[][]): string {
  return toCsv(header, rows);
}
