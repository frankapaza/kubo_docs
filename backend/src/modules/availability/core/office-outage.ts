// GENERADO — no editar; fuente: packages/monitoring-core/src
// Regenerar con: node scripts/sync-monitoring-core.mjs

/**
 * Caída de oficina: todas las referencias fallan y fallan al menos ceil(n/2)
 * de los n destinos (n >= 1).
 */
export function isOfficeOutage(referencesOk: boolean[], serviceResultsOk: boolean[]): boolean {
  const n = serviceResultsOk.length;
  if (referencesOk.length === 0 || n < 1) return false;
  if (referencesOk.some((ok) => ok)) return false;
  const failed = serviceResultsOk.filter((ok) => !ok).length;
  return failed >= Math.ceil(n / 2);
}
