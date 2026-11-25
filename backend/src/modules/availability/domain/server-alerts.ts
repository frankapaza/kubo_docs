import { AgentDisk } from '../entities/monitor-agent-sample.entity';
import { limaDateOf } from './expected-slots';
import { PROBE_SILENCE_MS } from './probe-silence';

export type ServerAlertKind = 'DISK_LOW' | 'AGENT_SILENT';

export interface ServerAlert {
  serverId: number;
  serverName: string;
  kind: ServerAlertKind;
  detail: string;
}

export interface ServerAlertInput {
  id: number;
  name: string;
  /** El servidor tiene token de agente vigente. */
  hasAgent: boolean;
  agentLastSeenAt: Date | null;
  agentTokenCreatedAt: Date | null;
  /** Discos de la última muestra del agente. */
  lastDisks: AgentDisk[] | null;
}

/** Disco bajo: espacio libre ÷ total por debajo de este umbral. */
export const DISK_LOW_RATIO = 0.1;

const LIMA_OFFSET_MS = 5 * 3600_000;

/** «HH:mm» en hora de Lima si es del mismo día que `now`; si no, «dd/MM HH:mm». */
function limaTime(at: Date, now: Date): string {
  const iso = new Date(at.getTime() - LIMA_OFFSET_MS).toISOString();
  const hhmm = iso.slice(11, 16);
  return limaDateOf(at) === limaDateOf(now) ? hhmm : `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${hhmm}`;
}

/**
 * Avisos de servidor que ve el widget (decisión 11):
 * - `AGENT_SILENT`: el servidor tiene agente y pasaron más de `PROBE_SILENCE_MS`
 *   desde la última muestra (o desde la emisión del token si nunca reportó).
 * - `DISK_LOW`: una unidad con menos del 10 % libre en la última muestra. Solo
 *   si el agente no está mudo: con datos viejos el aviso no sería fiable.
 */
export function serverAlertsFor(servers: ServerAlertInput[], now: Date): ServerAlert[] {
  const out: ServerAlert[] = [];
  for (const s of servers) {
    if (!s.hasAgent) continue;
    const ref = s.agentLastSeenAt ?? s.agentTokenCreatedAt;
    if (ref && now.getTime() - ref.getTime() > PROBE_SILENCE_MS) {
      out.push({ serverId: s.id, serverName: s.name, kind: 'AGENT_SILENT', detail: `sin datos desde ${limaTime(ref, now)}` });
      continue;
    }
    for (const d of s.lastDisks ?? []) {
      const total = Number(d.totalBytes);
      if (!(total > 0)) continue;
      const ratio = Number(d.freeBytes) / total;
      if (ratio < DISK_LOW_RATIO) {
        out.push({
          serverId: s.id,
          serverName: s.name,
          kind: 'DISK_LOW',
          detail: `${d.name} ${Math.floor(ratio * 100)} % libre`,
        });
      }
    }
  }
  return out;
}
