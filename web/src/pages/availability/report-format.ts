// Formatos de las pantallas de Disponibilidad, Servidores y Mantenimientos.
// Todo en hora de Lima (UTC-5 fijo, sin horario de verano).

const LIMA = 'America/Lima';
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

export function fmtLima(v: string | Date | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleString('es-PE', { timeZone: LIMA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtLimaTime(v: string | Date): string {
  return new Date(v).toLocaleTimeString('es-PE', { timeZone: LIMA, hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Mes «YYYY-MM» de hoy en Lima. */
export function limaMonthNow(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: LIMA, year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1] ?? month} ${y}`;
}

/** Valor de `<input type="datetime-local">` (hora de Lima) → ISO con desfase explícito. */
export function limaInputToIso(value: string): string {
  return `${value}${value.length === 16 ? ':00' : ''}-05:00`;
}

/** Instante → valor de `<input type="datetime-local">` en hora de Lima. */
export function isoToLimaInput(v: string | Date): string {
  const d = new Date(new Date(v).getTime() - 5 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export const fmtPct = (v: number | null | undefined, digits = 3): string => (v === null || v === undefined ? '—' : `${v.toFixed(digits)} %`);

export function fmtMinutes(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  const r = Math.round(m);
  if (r < 60) return `${r} min`;
  const h = Math.floor(r / 60);
  return r % 60 === 0 ? `${h} h` : `${h} h ${r % 60} min`;
}

/** Cuándo el agente deja de estar «Reportando»: 10 min, igual que el silencio del backend (AGENT_SILENT). */
export const AGENT_STALE_MS = 10 * 60_000;

export type AgentStatus = { kind: 'reporting' } | { kind: 'silent'; since: string } | { kind: 'none' };

export function agentStatus(hasToken: boolean, lastSampleAt: string | null, now: number = Date.now()): AgentStatus {
  if (!hasToken && !lastSampleAt) return { kind: 'none' };
  if (!lastSampleAt) return { kind: 'silent', since: '' };
  return now - new Date(lastSampleAt).getTime() <= AGENT_STALE_MS ? { kind: 'reporting' } : { kind: 'silent', since: lastSampleAt };
}

export const DISK_LOW_FREE_PCT = 10;
export const isDiskLow = (freePct: number | null): boolean => freePct !== null && freePct < DISK_LOW_FREE_PCT;

/** Puntos «x,y» de una polilínea 0-100 % dentro de `w`×`h`. */
export function sparkPoints(values: number[], w: number, h: number): string {
  if (values.length === 0) return '';
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => `${(i * step).toFixed(1)},${(h - (Math.min(100, Math.max(0, v)) / 100) * h).toFixed(1)}`).join(' ');
}

/** «W3SVC, Spooler» → lista; vacíos fuera y sin repetidos. */
export function parseWatchList(text: string): string[] {
  return [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))];
}

/** Igual que el backend; `$` aparece en instancias con nombre, p. ej. `MSSQL$SQLEXPRESS`. */
export const WATCH_SERVICE_RE = /^[A-Za-z0-9_.$\- ]+$/;
export const MAX_WATCH_SERVICES = 50;

/** Mensaje de error de la lista, o null si es válida. */
export function validateWatchList(list: string[]): string | null {
  if (list.length > MAX_WATCH_SERVICES) return `Máximo ${MAX_WATCH_SERVICES} servicios.`;
  const bad = list.find((s) => !WATCH_SERVICE_RE.test(s));
  return bad ? `«${bad}» tiene caracteres no permitidos (solo letras, números, espacio, _ . - $).` : null;
}
