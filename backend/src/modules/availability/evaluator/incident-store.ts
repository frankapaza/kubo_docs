import { EntityManager, In, IsNull, Not } from 'typeorm';
import type { Criticality } from '../core';
import { MonitorIncidentEvent } from '../entities/monitor-incident-event.entity';
import { MonitorIncident } from '../entities/monitor-incident.entity';

/**
 * Lo que se hace después de confirmar la transacción de una señal: hablar con
 * los tickets o con el worker no debe bloquear filas ni deshacerse a medias.
 * Si falla, la creación del ticket la recupera el barrido del final del tick;
 * comentarios y prioridad quedan como «a lo sumo una vez» (se registran en el log).
 */
export type PostCommitAction =
  | { type: 'ENSURE_TICKET'; incidentId: number; diagnosis?: string }
  | { type: 'REOPEN_TICKET'; incidentId: number }
  | { type: 'COMMENT'; incidentId: number; text: string }
  | { type: 'RAISE_PRIORITY'; incidentId: number; criticality: Criticality };

export type FailureKind = 'DOWN' | 'ROUTE';

/** Tipos de evento que cambian lo que hay que pedir al ticket: tras ellos se reintenta un 4xx. */
export const TICKET_RESET_EVENTS = ['OPENED', 'REOPENED', 'UPGRADED_TO_DOWN', 'PARENT_CREATED'];
export const TICKET_NOT_CREATED = 'TICKET_NOT_CREATED';

const CRIT_RANK: Record<Criticality, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export const num = (v: unknown): number => Number(v);
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function maxCriticality(list: Criticality[]): Criticality {
  return list.reduce<Criticality>((best, c) => (CRIT_RANK[c] < CRIT_RANK[best] ? c : best), 'LOW');
}

export const isFailureKind = (k: string): k is FailureKind => k === 'DOWN' || k === 'ROUTE';

/** Incidente abierto del servicio (de cualquier tipo: la clave única es una por servicio). */
export function openIncidentOf(m: EntityManager, serviceId: number): Promise<MonitorIncident | null> {
  return m.getRepository(MonitorIncident).findOne({ where: { serviceId, recoveredAt: IsNull() } });
}

export function openServerParentOf(m: EntityManager, serverId: number): Promise<MonitorIncident | null> {
  return m.getRepository(MonitorIncident).findOne({ where: { serverId, serviceId: IsNull(), recoveredAt: IsNull() } });
}

export function openChildrenOf(m: EntityManager, parentId: number): Promise<MonitorIncident[]> {
  return m.getRepository(MonitorIncident).find({ where: { parentId, recoveredAt: IsNull() } });
}

export function openFailureSiblings(m: EntityManager, serverId: number, exceptId: number): Promise<MonitorIncident[]> {
  return m.getRepository(MonitorIncident).find({
    where: { serverId, serviceId: Not(IsNull()), recoveredAt: IsNull(), kind: In(['DOWN', 'ROUTE']), id: Not(exceptId) },
  });
}

export async function insertIncident(m: EntityManager, row: Partial<MonitorIncident>): Promise<number> {
  const res = await m.getRepository(MonitorIncident).insert({
    parentId: null,
    recoveredAt: null,
    closeReason: null,
    ticketId: null,
    acknowledgedBy: null,
    acknowledgedAt: null,
    ...row,
  });
  return num(res.identifiers[0].id);
}

export async function addEvent(
  m: EntityManager,
  incidentId: number,
  at: Date,
  type: string,
  detail: Record<string, unknown> | null = null,
  authorUserId: number | null = null,
): Promise<void> {
  await m.getRepository(MonitorIncidentEvent).insert({ incidentId, at, type, detail: detail as any, authorUserId });
}

export async function closeIncident(
  m: EntityManager,
  id: number,
  at: Date,
  reason: 'RECOVERED' | 'SERVICE_PAUSED',
): Promise<void> {
  await m.getRepository(MonitorIncident).update({ id, recoveredAt: IsNull() }, { recoveredAt: at, closeReason: reason });
}

/** El incidente que lleva el ticket: el de servidor si el servicio cuelga de uno. */
export async function ticketOwnerOf(m: EntityManager, inc: MonitorIncident): Promise<MonitorIncident> {
  if (inc.parentId === null || inc.parentId === undefined) return inc;
  return (await m.getRepository(MonitorIncident).findOne({ where: { id: num(inc.parentId) } })) ?? inc;
}
