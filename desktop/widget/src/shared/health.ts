import { limaTime, type EngineReach } from './widget-model';

/** Pares etiqueta/valor del panel «Salud del monitor». */
export type HealthRows = Array<[string, string]>;

export function healthFrom(reach: EngineReach): HealthRows {
  switch (reach.kind) {
    case 'connecting': return [['Motor', 'Conectando…']];
    case 'down': return [['Motor', 'No responde']];
    case 'forbidden': return [['Motor', 'Sin permiso para leer el secreto local']];
  }
  const { engine, central, pending } = reach.status;
  return [
    ['Motor', `Activo · versión ${engine.version}`],
    ['Central', central.reachable ? 'Alcanzable' : 'No alcanzable'],
    ['Último sync', central.lastSyncAt ? limaTime(new Date(central.lastSyncAt)) : '—'],
    ['Pendientes de envío', String(pending)],
    ['Envíos rechazados', central.rejecting ? 'Sí' : 'No'],
  ];
}
