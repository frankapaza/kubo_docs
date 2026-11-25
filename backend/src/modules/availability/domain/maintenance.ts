/** Ventana de mantenimiento: de un servidor (cubre a todos sus servicios) o de un servicio. */
export interface MaintenanceWindow {
  id: number;
  serverId: number | null;
  serviceId: number | null;
  startsAt: Date;
  endsAt: Date;
  reason: string;
}

export interface MaintenanceTarget {
  /** Nulo para un incidente de servidor: entonces solo cuentan las ventanas del servidor. */
  serviceId: number | null;
  serverId: number;
}

/** ¿La ventana alcanza al objetivo? Una de servidor cubre a sus servicios; una de servicio, solo a ese servicio. */
function covers(w: MaintenanceWindow, target: MaintenanceTarget): boolean {
  if (w.serviceId !== null && w.serviceId !== undefined) {
    return target.serviceId !== null && Number(w.serviceId) === target.serviceId;
  }
  return w.serverId !== null && w.serverId !== undefined && Number(w.serverId) === target.serverId;
}

/**
 * La ventana activa en `at` que cubre al objetivo, o null. Intervalo semiabierto
 * `[startsAt, endsAt)`. Si cubren varias, la que termina más tarde.
 */
export function activeWindowFor(target: MaintenanceTarget, at: Date, windows: MaintenanceWindow[]): MaintenanceWindow | null {
  const t = at.getTime();
  let best: MaintenanceWindow | null = null;
  for (const w of windows) {
    if (!(w.startsAt.getTime() <= t && t < w.endsAt.getTime() && covers(w, target))) continue;
    if (!best || w.endsAt.getTime() > best.endsAt.getTime()) best = w;
  }
  return best;
}

/**
 * Tramos de mantenimiento del servicio dentro de `[from, to)`: une las ventanas
 * que se superponen (o se tocan) y las recorta al rango. Ordenados por inicio.
 */
export function maintenanceIntervalsFor(
  serviceId: number,
  serverId: number,
  windows: MaintenanceWindow[],
  from: Date,
  to: Date,
): Array<[Date, Date]> {
  const lo = from.getTime();
  const hi = to.getTime();
  const spans = windows
    .filter((w) => covers(w, { serviceId, serverId }))
    .map((w) => [Math.max(w.startsAt.getTime(), lo), Math.min(w.endsAt.getTime(), hi)] as [number, number])
    .filter(([a, b]) => a < b)
    .sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const [a, b] of spans) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged.map(([a, b]) => [new Date(a), new Date(b)]);
}
