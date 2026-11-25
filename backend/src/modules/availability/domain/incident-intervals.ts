export interface IncidentIntervalInput {
  kind: 'DOWN' | 'ROUTE' | 'DEGRADED';
  firstFailureAt: Date;
  recoveredAt: Date | null;
}

export interface IncidentInterval {
  kind: 'DOWN' | 'ROUTE';
  from: Date;
  to: Date;
}

/**
 * Tramos DOWN/ROUTE de un incidente de servicio. Un incidente abierto llega
 * hasta `until`. `upgradedAt` es el `at` del evento `UPGRADED_TO_DOWN`: la fila
 * ya dice DOWN, pero hasta ese instante fue ROUTE. DEGRADED no resta
 * disponibilidad → []. Nunca devuelve tramos vacíos.
 */
export function incidentIntervals(
  inc: IncidentIntervalInput,
  upgradedAt: Date | null,
  until: Date,
): IncidentInterval[] {
  if (inc.kind === 'DEGRADED') return [];
  const start = inc.firstFailureAt;
  const end = inc.recoveredAt ?? until;
  const raw: IncidentInterval[] = upgradedAt
    ? [
        { kind: 'ROUTE', from: start, to: upgradedAt },
        { kind: 'DOWN', from: upgradedAt, to: end },
      ]
    : [{ kind: inc.kind, from: start, to: end }];
  return raw
    .map((x) => ({
      kind: x.kind,
      from: new Date(Math.max(x.from.getTime(), start.getTime())),
      to: new Date(Math.min(x.to.getTime(), end.getTime())),
    }))
    .filter((x) => x.to.getTime() > x.from.getTime());
}
