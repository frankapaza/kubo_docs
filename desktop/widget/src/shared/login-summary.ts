import type { EngineEvent } from './types';
import type { WidgetModel, WidgetRow } from './widget-model';

export interface LoginSummary {
  opened: number;
  recovered: number;
  officeOutages: number;
  centralOutages: number;
  stillActive: WidgetRow[];
  lines: string[];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function names(events: EngineEvent[]): string {
  const seen: string[] = [];
  for (const e of events) {
    const label = e.serviceNames.length > 1 && e.serverName ? e.serverName : e.serviceNames[0] ?? e.serverName;
    if (label && !seen.includes(label)) seen.push(label);
  }
  return seen.join(', ');
}

function withNames(base: string, events: EngineEvent[]): string {
  const n = names(events);
  return n ? `${base}: ${n}` : base;
}

const isOutage = (e: EngineEvent): boolean => e.incidentKind === 'DOWN' || e.incidentKind === 'ROUTE';

/**
 * Resumen de lo ocurrido desde la última sesión (`at` > `since`) y lo que sigue activo.
 * `null` si no hubo nada relevante, o en el primer arranque (`since` null: no hay sesión previa).
 * La degradación no entra en el resumen.
 */
export function summarize(events: EngineEvent[], since: string | null, model: WidgetModel): LoginSummary | null {
  if (since === null) return null;
  const from = Date.parse(since);
  if (Number.isNaN(from)) return null;
  const recent = events.filter((e) => Date.parse(e.at) > from);
  const opened = recent.filter((e) => (e.kind === 'INCIDENT_OPENED' || e.kind === 'INCIDENT_UPGRADED') && isOutage(e));
  const recovered = recent.filter((e) => e.kind === 'INCIDENT_RECOVERED');
  const officeOutages = recent.filter((e) => e.kind === 'OFFICE_OUTAGE_STARTED').length;
  const centralOutages = recent.filter((e) => e.kind === 'CENTRAL_UNREACHABLE').length;
  if (opened.length + recovered.length + officeOutages + centralOutages === 0) return null;

  const stillActive = model.rows;
  const lines: string[] = [];
  if (opened.length) lines.push(withNames(plural(opened.length, 'incidente abierto', 'incidentes abiertos'), opened));
  if (recovered.length) lines.push(withNames(plural(recovered.length, 'recuperado', 'recuperados'), recovered));
  if (officeOutages) lines.push(plural(officeOutages, 'corte de internet en la oficina', 'cortes de internet en la oficina'));
  if (centralOutages) lines.push(`La central dejó de responder ${plural(centralOutages, 'vez', 'veces')}`);
  lines.push(stillActive.length
    ? `${stillActive.length === 1 ? 'Sigue activo' : 'Siguen activos'}: ${stillActive.map((r) => r.title).join(', ')}`
    : 'Ahora todo está operativo');
  return { opened: opened.length, recovered: recovered.length, officeOutages, centralOutages, stillActive, lines };
}
