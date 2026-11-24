import { intervalMsAt, ScheduleConfig } from '../core';
import { MonitorIncident } from '../entities/monitor-incident.entity';
import { MonitorProbeState } from '../entities/monitor-probe-state.entity';
import { MonitorProbe } from '../entities/monitor-probe.entity';
import { MonitorServer } from '../entities/monitor-server.entity';
import { MonitorService } from '../entities/monitor-service.entity';
import { CombinedStateRow, combineStatus, ProbeView } from './combined-state';

export interface CombinedStateInput {
  services: MonitorService[];
  servers: MonitorServer[];
  probes: MonitorProbe[];
  states: MonitorProbeState[];
  /** Solo los incidentes abiertos. */
  openIncidents: MonitorIncident[];
  schedule: ScheduleConfig;
  now: Date;
}

/** Estado combinado por servicio (`ticketCode` queda en null: lo rellena la API del personal). Lo comparten `sync` y la API del personal. */
export function buildCombinedRows(input: CombinedStateInput): CombinedStateRow[] {
  const serverById = new Map(input.servers.map((s) => [Number(s.id), s]));
  const kindByProbe = new Map(input.probes.map((p) => [Number(p.id), p.kind]));
  const viewOf = new Map<string, ProbeView>();
  for (const st of input.states) {
    const kind = kindByProbe.get(Number(st.probeId));
    if (!kind) continue;
    viewOf.set(`${kind}|${Number(st.serviceId)}`, {
      state: st.state,
      lastCheckAt: st.lastCheckAt ?? null,
      lastLatencyMs: st.lastLatencyMs === null || st.lastLatencyMs === undefined ? null : Number(st.lastLatencyMs),
    });
  }
  const incidentByService = new Map<number, MonitorIncident>();
  for (const inc of input.openIncidents) if (inc.serviceId !== null) incidentByService.set(Number(inc.serviceId), inc);

  const intervalMs = intervalMsAt(input.now, input.schedule);
  const rows: CombinedStateRow[] = [];
  for (const svc of input.services) {
    const server = serverById.get(Number(svc.serverId));
    if (!server) continue;
    const id = Number(svc.id);
    const office = viewOf.get(`OFFICE|${id}`) ?? null;
    const datacenter = viewOf.get(`DATACENTER|${id}`) ?? null;
    const incident = incidentByService.get(id) ?? null;
    rows.push({
      serviceId: id,
      serverId: Number(server.id),
      clientId: Number(server.clientId),
      serviceName: svc.name,
      serverName: server.name,
      criticality: svc.criticality,
      office,
      datacenter,
      status: combineStatus(office, datacenter, incident?.kind ?? null, input.now, intervalMs),
      incidentId: incident ? Number(incident.id) : null,
      parentIncidentId: incident?.parentId != null ? Number(incident.parentId) : null,
      ticketCode: null,
    });
  }
  return rows;
}
