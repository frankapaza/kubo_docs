import { BadRequestException } from '@nestjs/common';

import { readZipEntry, zipEntryNames } from '../../work-items/domain/work-item-docs';

/**
 * El cronograma de un documento: una tabla Markdown
 * `| Actividad | Responsable | Inicio | Fin |` (fechas AAAA-MM-DD) que el
 * editor muestra como Gantt y el PDF dibuja debajo de la tabla. También se
 * arma desde un Excel genérico (p. ej. el que exporta MS Project).
 */

export interface ScheduleRow {
  activity: string;
  owner: string;
  /** AAAA-MM-DD */
  start: string;
  /** AAAA-MM-DD */
  end: string;
}

export const SCHEDULE_HEADER = '| Actividad | Responsable | Inicio | Fin |';
export const MAX_SCHEDULE_ROWS = 300;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validIso(s: string): boolean {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function cell(v: string): string {
  return v.replace(/[|\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** Las filas del cronograma si la sección tiene la tabla; null si no la tiene. */
export function parseScheduleTable(markdown: string): ScheduleRow[] | null {
  const lines = markdown.split(/\r?\n/).map((l) => l.trim());
  const h = lines.findIndex((l) => /^\|\s*actividad\s*\|\s*responsable\s*\|\s*inicio\s*\|\s*fin\s*\|$/i.test(l));
  if (h < 0) return null;
  const rows: ScheduleRow[] = [];
  for (let i = h + 1; i < lines.length && lines[i].startsWith('|'); i++) {
    const parts = lines[i].replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (parts.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    const [activity = '', owner = '', start = '', end = ''] = parts;
    if (!activity) continue;
    rows.push({ activity, owner: owner === '—' ? '' : owner, start, end });
  }
  return rows;
}

/** La tabla Markdown de unas filas (lo que se guarda en la sección). */
export function scheduleTable(rows: ScheduleRow[]): string {
  return [
    SCHEDULE_HEADER,
    '| --- | --- | --- | --- |',
    ...rows.map((r) => `| ${cell(r.activity)} | ${cell(r.owner) || '—'} | ${r.start} | ${r.end} |`),
  ].join('\n');
}

/** Solo las filas con fechas válidas e inicio ≤ fin: las que se pueden dibujar. */
export function drawableRows(rows: ScheduleRow[]): ScheduleRow[] {
  return rows.filter((r) => validIso(r.start) && validIso(r.end) && r.start <= r.end);
}

// ------------------------------------------------------------------ fechas

/** Excel cuenta días desde 1899-12-30 (sistema 1900, con su 29-feb inexistente ya absorbido). */
function fromSerial(n: number): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return null;
  const ms = Math.round((n - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

const MONTHS: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
  set: 9, sep: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};

/**
 * Una fecha como la escribe Excel o MS Project: número de serie, 2026-12-01,
 * 01/12/2026, «lun 01/12/26», «1 dic 2026». Se asume día/mes (Perú).
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/^[a-záéíóúñ]{2,4}\.?\s+(?=\d)/, '');
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return fromSerial(Number(s));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) return iso(fullYear(+m[3]), +m[2], +m[1]);
  m = /^(\d{1,2})\s+(?:de\s+)?([a-z]{3})[a-z]*\.?\s+(?:de\s+)?(\d{2,4})/.exec(s);
  if (m && MONTHS[m[2]]) return iso(fullYear(+m[3]), MONTHS[m[2]], +m[1]);
  return null;
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function iso(y: number, mo: number, d: number): string | null {
  const s = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return validIso(s) ? s : null;
}

// ------------------------------------------------------------------ Excel

function xmlText(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function colIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Las filas de la primera hoja de un .xlsx como texto (sin librerías: es XML dentro de un ZIP). */
export function xlsxRows(buf: Buffer): string[][] {
  const names = zipEntryNames(buf);
  if (!names || !names.includes('xl/workbook.xml')) {
    throw new BadRequestException({ code: 'BAD_INPUT', message: 'El archivo no es un Excel (.xlsx) válido.' });
  }
  const shared: string[] = [];
  const sst = readZipEntry(buf, 'xl/sharedStrings.xml')?.toString('utf8');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText(m[1]));
  const sheetName = names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  const sheet = sheetName ? readZipEntry(buf, sheetName)?.toString('utf8') : null;
  if (!sheet) throw new BadRequestException({ code: 'BAD_INPUT', message: 'El Excel no tiene hojas con datos.' });
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '';
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let text = '';
      if (type === 's' && v != null) text = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') text = xmlText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '');
      else if (v != null) text = xmlText(v);
      row[ref ? colIndex(ref) : row.length] = text.trim();
    }
    rows.push(Array.from(row, (x) => x ?? ''));
    if (rows.length > MAX_SCHEDULE_ROWS + 20) break;
  }
  return rows;
}

const COLS: Record<keyof ScheduleRow, RegExp> = {
  activity: /^(nombre de (la )?tarea|tarea|actividad|nombre|task name|task|name|entregable|hito)/i,
  owner: /^(responsable|nombres? de (los )?recursos?|recursos?|asignado|owner|resource names?)/i,
  start: /^(comienzo|inicio|fecha de inicio|start|start date)/i,
  end: /^(fin|término|termino|fecha (de )?fin|finish|end|end date)/i,
};

/** Del Excel a filas de cronograma: busca la fila de encabezados y lee tarea, responsable, inicio y fin. */
export function scheduleFromSheet(rows: string[][]): ScheduleRow[] {
  const headerIdx = rows.findIndex(
    (r) => r.some((c) => COLS.activity.test(c)) && r.some((c) => COLS.start.test(c)) && r.some((c) => COLS.end.test(c)),
  );
  if (headerIdx < 0) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'No encontré las columnas. El Excel necesita encabezados como «Tarea» (o «Actividad»), «Inicio» y «Fin»; «Responsable» es opcional.',
    });
  }
  const header = rows[headerIdx];
  const col = (k: keyof ScheduleRow) => header.findIndex((c) => COLS[k].test(c));
  const ci = { activity: col('activity'), owner: col('owner'), start: col('start'), end: col('end') };
  const out: ScheduleRow[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const activity = (r[ci.activity] ?? '').trim();
    if (!activity) continue;
    const start = parseDate(r[ci.start] ?? '');
    const end = parseDate(r[ci.end] ?? '');
    if (!start || !end) continue;
    out.push({ activity: activity.slice(0, 200), owner: ci.owner >= 0 ? (r[ci.owner] ?? '').slice(0, 120) : '', start, end: end < start ? start : end });
    if (out.length >= MAX_SCHEDULE_ROWS) break;
  }
  if (!out.length) {
    throw new BadRequestException({ code: 'BAD_INPUT', message: 'El Excel no tiene filas con tarea, inicio y fin válidos.' });
  }
  return out;
}

/** Un CSV simple (`;` o `,`), por si el cronograma llega así. */
export function csvRows(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = (lines[0]?.split(';').length ?? 0) >= (lines[0]?.split(',').length ?? 0) ? ';' : ',';
  return lines.map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
}
