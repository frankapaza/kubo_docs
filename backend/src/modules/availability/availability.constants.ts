import type { ServiceTarget } from './core';

/**
 * Usuario de sistema (migración 035) que firma los tickets automáticos del
 * monitoreo. Está inactivo: no puede iniciar sesión.
 */
export const MONITORING_ACTOR_EMAIL = 'monitoreo@sistema.kubo';

/**
 * Referencias de la oficina (1.1.1.1 y 8.8.8.8) como `ServiceTarget` con id
 * negativo: nunca chocan con `monitor_services.id` (unsigned). Se eligió TCP
 * (443 y 53) y no ICMP porque no exige privilegios ni raw sockets en la
 * máquina de la oficina; ambos resolvers aceptan TCP en esos puertos.
 * Única fuente: entran en la `configVersion` y en `SyncResponse.references`.
 */
export const PROBE_REFERENCES: ReadonlyArray<ServiceTarget> = [
  { id: -1, protocol: 'TCP', target: '1.1.1.1', port: 443, latencyThresholdMs: 1500 },
  { id: -2, protocol: 'TCP', target: '8.8.8.8', port: 53, latencyThresholdMs: 1500 },
];
