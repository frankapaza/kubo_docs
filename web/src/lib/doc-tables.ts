/**
 * Las tablas con estructura del editor de entregables: cronograma,
 * participantes y roles. Mismo formato que el backend
 * (backend/src/modules/projects/expediente/schedule.ts y la tabla de
 * participantes de las actas).
 */

export interface ScheduleRow {
  activity: string;
  owner: string;
  start: string;
  end: string;
}

const SCHEDULE_HEADER_RE = /^\|\s*actividad\s*\|\s*responsable\s*\|\s*inicio\s*\|\s*fin\s*\|$/i;

function cell(v: string): string {
  return v.replace(/[|\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

function isSeparator(parts: string[]): boolean {
  return parts.length > 0 && parts.every((c) => /^:?-{3,}:?$/.test(c));
}

/** Dónde está una tabla (desde su encabezado) dentro del texto: [inicio, fin) en líneas. */
function tableRange(lines: string[], header: RegExp): [number, number] | null {
  const h = lines.findIndex((l) => header.test(l.trim()));
  if (h < 0) return null;
  let e = h + 1;
  while (e < lines.length && lines[e].trim().startsWith('|')) e++;
  return [h, e];
}

export function parseSchedule(body: string): ScheduleRow[] | null {
  const lines = body.split(/\r?\n/);
  const r = tableRange(lines, SCHEDULE_HEADER_RE);
  if (!r) return null;
  const rows: ScheduleRow[] = [];
  for (const line of lines.slice(r[0] + 1, r[1])) {
    const parts = splitRow(line);
    if (isSeparator(parts)) continue;
    const [activity = '', owner = '', start = '', end = ''] = parts;
    rows.push({ activity, owner: owner === '—' ? '' : owner, start, end });
  }
  return rows;
}

export function scheduleTable(rows: ScheduleRow[]): string {
  return [
    '| Actividad | Responsable | Inicio | Fin |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => `| ${cell(r.activity)} | ${cell(r.owner) || '—'} | ${r.start} | ${r.end} |`),
  ].join('\n');
}

/** Reemplaza la tabla del cronograma dentro del texto (o la agrega al final), sin tocar el resto. */
export function replaceSchedule(body: string, rows: ScheduleRow[]): string {
  const lines = body.split(/\r?\n/);
  const r = tableRange(lines, SCHEDULE_HEADER_RE);
  const table = scheduleTable(rows);
  if (!r) return body.trim() ? `${body.trimEnd()}\n\n${table}` : table;
  return [...lines.slice(0, r[0]), table, ...lines.slice(r[1])].join('\n');
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function drawable(rows: ScheduleRow[]): ScheduleRow[] {
  return rows.filter((r) => ISO.test(r.start) && ISO.test(r.end) && r.start <= r.end);
}

// ---------------------------------------------------------------- participantes y roles

export interface PersonRow {
  name: string;
  role: string;
  email: string;
  phone: string;
  attended?: boolean;
}

export function participantsTable(people: PersonRow[]): string {
  return [
    '| Nombre | Cargo | Correo | Teléfono | Asistencia |',
    '| --- | --- | --- | --- | --- |',
    ...people.map(
      (p) =>
        `| ${cell(p.name) || '—'} | ${cell(p.role) || '—'} | ${cell(p.email) || '—'} | ${cell(p.phone) || '—'} | ${
          p.attended === undefined ? '—' : p.attended ? 'Asistió' : 'No asistió'
        } |`,
    ),
  ].join('\n');
}

/** Las personas de la tabla de participantes (nombre, cargo, correo, teléfono). */
export function parseParticipants(body: string): PersonRow[] {
  const lines = body.split(/\r?\n/);
  const r = tableRange(lines, /^\|\s*nombre\s*\|/i);
  if (!r) return [];
  const head = splitRow(lines[r[0]]).map((h) => h.toLowerCase());
  const at = (re: RegExp) => head.findIndex((h) => re.test(h));
  const ci = { name: at(/^nombre/), role: at(/^(cargo|rol)/), email: at(/^(correo|email)/), phone: at(/^tel/) };
  const out: PersonRow[] = [];
  for (const line of lines.slice(r[0] + 1, r[1])) {
    const parts = splitRow(line);
    if (isSeparator(parts)) continue;
    const get = (i: number) => (i >= 0 ? (parts[i] ?? '').replace(/^—$/, '') : '');
    const name = get(ci.name);
    if (!name || /\[completar\]/i.test(name)) continue;
    out.push({ name, role: get(ci.role), email: get(ci.email), phone: get(ci.phone) });
  }
  return out;
}

/** Roles y responsables a partir de los participantes: el cargo como rol. */
export function rolesFromParticipants(people: PersonRow[]): string {
  return [
    '| Rol | Responsable | Correo |',
    '| --- | --- | --- |',
    ...people.map((p) => `| ${cell(p.role) || '[Completar]'} | ${cell(p.name)} | ${cell(p.email) || '—'} |`),
  ].join('\n');
}
