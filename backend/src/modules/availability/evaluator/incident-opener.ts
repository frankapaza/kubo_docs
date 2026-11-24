import { EntityManager, In, IsNull, Not } from 'typeorm';
import { isDuplicateEntry } from '../../../common/db-errors';
import { groupDecision, reopenCandidate } from '../domain/incident-rules';
import { MonitorIncident } from '../entities/monitor-incident.entity';
import { MonitorService } from '../entities/monitor-service.entity';
import {
  addEvent,
  closeIncident,
  FailureKind,
  insertIncident,
  isFailureKind,
  maxCriticality,
  num,
  numOrNull,
  openFailureSiblings,
  openIncidentOf,
  openServerParentOf,
  PostCommitAction,
  ticketOwnerOf,
} from './incident-store';

export interface OpenFailureInput {
  service: MonitorService;
  diagnosis: { kind: FailureKind; label: string };
  firstFailureAt: Date;
  confirmedAt: Date;
  now: Date;
  /** Datos del cruce para la cronología. */
  detail: Record<string, unknown>;
}

/**
 * Abre (o reabre, decisión 15) el incidente DOWN/ROUTE de un servicio y lo
 * agrupa en el incidente de servidor si corresponde (decisión 19). Corre
 * dentro de la transacción de la señal; devuelve lo que hay que pedir a los
 * tickets después de confirmarla. Idempotente: si el servicio ya tiene un
 * DOWN/ROUTE abierto (o la clave única lo impide) no hace nada.
 */
export async function openFailureIncident(m: EntityManager, input: OpenFailureInput): Promise<PostCommitAction[]> {
  const { service, diagnosis, now } = input;
  const serviceId = num(service.id);
  const current = await openIncidentOf(m, serviceId);
  if (current && isFailureKind(current.kind)) return [];
  if (current) {
    // Una caída reemplaza a la degradación abierta (la clave única admite un solo abierto).
    await closeIncident(m, num(current.id), input.confirmedAt, 'RECOVERED');
    await addEvent(m, num(current.id), now, 'SUPERSEDED', { by: diagnosis.kind });
  }

  const last = await m.getRepository(MonitorIncident).findOne({
    where: { serviceId, recoveredAt: Not(IsNull()), kind: In(['DOWN', 'ROUTE']) },
    order: { recoveredAt: 'DESC' },
  });
  const reopenId =
    last && last.recoveredAt && last.closeReason
      ? reopenCandidate({ id: num(last.id), kind: last.kind, recoveredAt: last.recoveredAt, closeReason: last.closeReason }, now)
      : null;
  if (last && reopenId !== null) return reopen(m, last, input);

  let id: number;
  try {
    id = await insertIncident(m, {
      serviceId,
      serverId: num(service.serverId),
      kind: diagnosis.kind,
      firstFailureAt: input.firstFailureAt,
      confirmedAt: input.confirmedAt,
    });
  } catch (e) {
    if (isDuplicateEntry(e)) return [];
    throw e;
  }
  await addEvent(m, id, now, 'OPENED', { diagnosis: diagnosis.label, ...input.detail });
  return group(m, id, input);
}

async function reopen(m: EntityManager, last: MonitorIncident, input: OpenFailureInput): Promise<PostCommitAction[]> {
  const repo = m.getRepository(MonitorIncident);
  const id = num(last.id);
  try {
    await repo.update({ id }, { kind: input.diagnosis.kind, recoveredAt: null, closeReason: null });
  } catch (e) {
    if (isDuplicateEntry(e)) return [];
    throw e;
  }
  await addEvent(m, id, input.now, 'REOPENED', {
    diagnosis: input.diagnosis.label,
    previousRecoveredAt: last.recoveredAt ? last.recoveredAt.toISOString() : null,
    ...input.detail,
  });

  const parentId = numOrNull(last.parentId);
  if (parentId !== null) {
    const parent = await repo.findOne({ where: { id: parentId } });
    if (parent && parent.recoveredAt === null) {
      // Su incidente de servidor sigue abierto (otro servicio no se recuperó): el ticket es el del padre.
      if (input.diagnosis.kind === 'DOWN' && parent.kind === 'ROUTE') await repo.update({ id: parentId }, { kind: 'DOWN' });
      return [
        { type: 'REOPEN_TICKET', incidentId: parentId },
        { type: 'RAISE_PRIORITY', incidentId: parentId, criticality: input.service.criticality },
      ];
    }
    // El padre ya se cerró: el servicio sigue solo, con el ticket que heredó.
    await repo.update({ id }, { parentId: null });
  }
  return [{ type: 'REOPEN_TICKET', incidentId: id }];
}

async function group(m: EntityManager, id: number, input: OpenFailureInput): Promise<PostCommitAction[]> {
  const serverId = num(input.service.serverId);
  const siblings = await openFailureSiblings(m, serverId, id);
  const parent = await openServerParentOf(m, serverId);
  const decision = groupDecision(
    input.confirmedAt,
    siblings.map((s) => ({ incidentId: num(s.id), confirmedAt: s.confirmedAt, parentId: numOrNull(s.parentId) })),
    parent ? num(parent.id) : null,
  );
  if (decision.action === 'JOIN_PARENT' && parent) return joinParent(m, id, parent, input);
  if (decision.action === 'CREATE_PARENT') {
    const ids = new Set(decision.siblingIds);
    return createParent(m, id, siblings.filter((s) => ids.has(num(s.id))), input);
  }
  return [{ type: 'ENSURE_TICKET', incidentId: id, diagnosis: input.diagnosis.label }];
}

async function joinParent(
  m: EntityManager,
  childId: number,
  parent: MonitorIncident,
  input: OpenFailureInput,
): Promise<PostCommitAction[]> {
  const repo = m.getRepository(MonitorIncident);
  const parentId = num(parent.id);
  const ticketId = numOrNull(parent.ticketId);
  await repo.update({ id: childId }, { parentId, ticketId });
  if (input.diagnosis.kind === 'DOWN' && parent.kind === 'ROUTE') await repo.update({ id: parentId }, { kind: 'DOWN' });
  await addEvent(m, childId, input.now, 'JOINED_SERVER_INCIDENT', { parentId });
  if (ticketId === null) return [{ type: 'ENSURE_TICKET', incidentId: parentId }];
  return [
    {
      type: 'COMMENT',
      incidentId: parentId,
      text: `Se sumó el servicio ${input.service.name} al incidente del servidor (${input.diagnosis.label}).`,
    },
    { type: 'RAISE_PRIORITY', incidentId: parentId, criticality: input.service.criticality },
  ];
}

async function createParent(
  m: EntityManager,
  childId: number,
  siblings: MonitorIncident[],
  input: OpenFailureInput,
): Promise<PostCommitAction[]> {
  const repo = m.getRepository(MonitorIncident);
  const serverId = num(input.service.serverId);
  const byConfirmed = [...siblings].sort((a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime());
  const inherited = byConfirmed.find((s) => s.ticketId !== null && s.ticketId !== undefined);
  // El padre hereda el ticket del primer hijo: el ticket ya existente pasa a ser el del servidor.
  const ticketId = inherited ? num(inherited.ticketId) : null;
  const kinds = [...siblings.map((s) => s.kind), input.diagnosis.kind];
  const firstFailureAt = new Date(Math.min(input.firstFailureAt.getTime(), ...siblings.map((s) => s.firstFailureAt.getTime())));
  const confirmedAt = new Date(Math.min(input.confirmedAt.getTime(), ...siblings.map((s) => s.confirmedAt.getTime())));

  let parentId: number;
  try {
    parentId = await insertIncident(m, {
      serviceId: null,
      serverId,
      kind: kinds.includes('DOWN') ? 'DOWN' : 'ROUTE',
      firstFailureAt,
      confirmedAt,
      ticketId,
    });
  } catch (e) {
    if (!isDuplicateEntry(e)) throw e;
    const existing = await openServerParentOf(m, serverId);
    if (!existing) throw e;
    return joinParent(m, childId, existing, input);
  }

  const childIds = [...siblings.map((s) => num(s.id)), childId];
  await repo.update({ id: In(childIds) }, { parentId });
  if (ticketId !== null) await repo.update({ id: In(childIds), ticketId: IsNull() }, { ticketId });

  const serviceIds = [...siblings.map((s) => num(s.serviceId)), num(input.service.id)];
  const services = await m.getRepository(MonitorService).find({ where: { id: In(serviceIds) } });
  const names = services.map((s) => s.name);
  await addEvent(m, parentId, input.now, 'PARENT_CREATED', { serviceIds, incidentIds: childIds });
  for (const cid of childIds) await addEvent(m, cid, input.now, 'JOINED_SERVER_INCIDENT', { parentId });

  if (ticketId === null) return [{ type: 'ENSURE_TICKET', incidentId: parentId }];
  return [
    {
      type: 'COMMENT',
      incidentId: parentId,
      text: `Caída del servidor: ${names.length} servicios afectados en menos de 3 minutos: ${names.join(', ')}.`,
    },
    { type: 'RAISE_PRIORITY', incidentId: parentId, criticality: maxCriticality(services.map((s) => s.criticality)) },
  ];
}

/** Un ROUTE que también falla desde el servidor pasa a DOWN: mismo incidente, mismo ticket. */
export async function upgradeToDown(
  m: EntityManager,
  inc: MonitorIncident,
  service: MonitorService,
  now: Date,
): Promise<PostCommitAction[]> {
  const repo = m.getRepository(MonitorIncident);
  const id = num(inc.id);
  await repo.update({ id }, { kind: 'DOWN' });
  await addEvent(m, id, now, 'UPGRADED_TO_DOWN', { reporter: 'DATACENTER' });
  const owner = await ticketOwnerOf(m, inc);
  if (num(owner.id) !== id && owner.kind === 'ROUTE') {
    await repo.update({ id: num(owner.id) }, { kind: 'DOWN' });
    await addEvent(m, num(owner.id), now, 'UPGRADED_TO_DOWN', { reporter: 'DATACENTER', serviceId: num(service.id) });
  }
  return [
    {
      type: 'COMMENT',
      incidentId: num(owner.id),
      text: `Reclasificado a DOWN: ${service.name} tampoco responde desde el servidor de KUBO (Sin respuesta confirmada).`,
    },
  ];
}
