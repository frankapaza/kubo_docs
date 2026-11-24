import { In, Repository } from 'typeorm';
import { TicketsRepository } from '../tickets/tickets.repository';
import { MonitorIncident } from './entities/monitor-incident.entity';

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Código del ticket de cada incidente: el suyo, o el del padre si es un hijo.
 * Regla única que comparten la API del personal y `sync`. Dos consultas como
 * máximo: los padres (solo si hay hijos) y los códigos en un lote.
 */
export async function ticketCodesForIncidents(
  incidentsRepo: Repository<MonitorIncident>,
  tickets: Pick<TicketsRepository, 'findCodesByIds'>,
  incidents: MonitorIncident[],
): Promise<Map<number, string | null>> {
  const parentIds = [...new Set(incidents.map((i) => numOrNull(i.parentId)).filter((p): p is number => p !== null))];
  const parents = parentIds.length ? await incidentsRepo.find({ where: { id: In(parentIds) } }) : [];
  const parentById = new Map(parents.map((p) => [num(p.id), p]));
  const ticketOf = (i: MonitorIncident): number | null => {
    const pid = numOrNull(i.parentId);
    return pid === null ? numOrNull(i.ticketId) : numOrNull(parentById.get(pid)?.ticketId ?? null);
  };
  const codeByTicket = await tickets.findCodesByIds(incidents.map(ticketOf).filter((t): t is number => t !== null));
  return new Map(incidents.map((i) => [num(i.id), ticketOf(i) === null ? null : (codeByTicket.get(ticketOf(i) as number) ?? null)]));
}
