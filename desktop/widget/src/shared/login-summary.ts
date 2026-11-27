import type { EngineEvent } from './types';
import { serverAlertKey, type WidgetModel, type WidgetRow } from './widget-model';

export interface LoginSummary {
  opened: number;
  recovered: number;
  officeOutages: number;
  centralOutages: number;
  /** Alertas de servidor aparecidas desde la última sesión (una por servidor, tipo y unidad). */
  alertsStarted: number;
  /** Alertas de servidor que siguen activas. */
  serverAlerts: number;
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
 * La degradación no entra en el resumen. Las alertas de servidor sí: las aparecidas y las que siguen activas.
 */
export function summarize(events: EngineEvent[], since: string | null, model: WidgetModel): LoginSummary | null {
  if (since === null) return null;
  const from = Date.parse(since);
  if (Number.isNaN(from)) return null;
  // Un corte de internet de la oficina deja también sin central: el CENTRAL_UNREACHABLE dentro de
  // la ventana STARTED..ENDED es el mismo corte y no se cuenta aparte. La ventana se sigue sobre
  // todo el diario (en orden de id), por si el corte empezó antes de `since`.
  const centralInOutage = new Set<number>();
  let inOfficeOutage = false;
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    if (e.kind === 'OFFICE_OUTAGE_STARTED') inOfficeOutage = true;
    else if (e.kind === 'OFFICE_OUTAGE_ENDED') inOfficeOutage = false;
    else if (e.kind === 'CENTRAL_UNREACHABLE' && inOfficeOutage) centralInOutage.add(e.id);
  }
  const recent = events.filter((e) => Date.parse(e.at) > from);
  const opened = recent.filter((e) => (e.kind === 'INCIDENT_OPENED' || e.kind === 'INCIDENT_UPGRADED') && isOutage(e));
  const recovered = recent.filter((e) => e.kind === 'INCIDENT_RECOVERED');
  const officeOutages = recent.filter((e) => e.kind === 'OFFICE_OUTAGE_STARTED').length;
  // Un CENTRAL_UNREACHABLE sin aviso es solo historial: el motor lo anota así durante un corte de oficina.
  const centralOutages = recent.filter((e) => e.kind === 'CENTRAL_UNREACHABLE' && e.notify && !centralInOutage.has(e.id)).length;
  const alerts = recent.filter((e) => e.kind === 'SERVER_ALERT_STARTED' && e.serverId != null && e.alertKind != null);
  const alertKeys = new Set(alerts.map((e) => serverAlertKey(e.serverId!, e.alertKind!, e.detail ?? '')));
  if (opened.length + recovered.length + officeOutages + centralOutages + alertKeys.size === 0) return null;
  // Un incidente reabierto o escalado sigue siendo el mismo: se cuenta por `incidentKey` (también al recuperarse).
  const openedCount = new Set(opened.map((e) => e.incidentKey ?? `e:${e.id}`)).size;
  const recoveredCount = new Set(recovered.map((e) => e.incidentKey ?? `e:${e.id}`)).size;

  const stillActive = model.rows;
  const serverAlerts = stillActive.filter((r) => r.serverId !== undefined).length;
  const lines: string[] = [];
  if (openedCount) lines.push(withNames(plural(openedCount, 'incidente abierto', 'incidentes abiertos'), opened));
  if (recoveredCount) lines.push(withNames(plural(recoveredCount, 'recuperado', 'recuperados'), recovered));
  if (officeOutages) lines.push(plural(officeOutages, 'corte de internet en la oficina', 'cortes de internet en la oficina'));
  if (centralOutages) lines.push(`La central dejó de responder ${plural(centralOutages, 'vez', 'veces')}`);
  if (alertKeys.size) lines.push(withNames(plural(alertKeys.size, 'aviso de servidor', 'avisos de servidor'), alerts));
  lines.push(stillActive.length
    ? `${stillActive.length === 1 ? 'Sigue activo' : 'Siguen activos'}: ${stillActive.map((r) => r.title).join(', ')}`
    : 'Ahora todo está operativo');
  return { opened: openedCount, recovered: recoveredCount, officeOutages, centralOutages, alertsStarted: alertKeys.size, serverAlerts, stillActive, lines };
}
