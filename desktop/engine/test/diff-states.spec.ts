import type { CombinedStateRow } from '../src/central-client';
import { diffStates } from '../src/events/diff-states';

const row = (serviceId: number, over: Partial<CombinedStateRow> = {}): CombinedStateRow => ({
  serviceId,
  serverId: 10,
  clientId: 100,
  serviceName: `svc-${serviceId}`,
  serverName: 'srv-a',
  criticality: 'HIGH',
  office: null,
  datacenter: null,
  status: 'OK',
  incidentId: null,
  parentIncidentId: null,
  ticketCode: null,
  ...over,
});

describe('diffStates', () => {
  it('prev null (primer estado tras arrancar) → ningún evento', () => {
    expect(diffStates(null, [row(1, { status: 'DOWN', incidentId: 5 })])).toEqual([]);
  });

  it('abrir DOWN HIGH → un INCIDENT_OPENED con notify true', () => {
    const ev = diffStates([row(1)], [row(1, { status: 'DOWN', incidentId: 5, ticketCode: 'KT-1' })]);
    expect(ev).toEqual([
      {
        kind: 'INCIDENT_OPENED',
        incidentKey: 5,
        incidentKind: 'DOWN',
        serverName: 'srv-a',
        serviceNames: ['svc-1'],
        criticality: 'HIGH',
        ticketCode: 'KT-1',
        notify: true,
      },
    ]);
  });

  it('abrir ROUTE MEDIUM → OPENED con notify false', () => {
    const ev = diffStates([row(1)], [row(1, { status: 'ROUTE', incidentId: 5, criticality: 'MEDIUM' })]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'INCIDENT_OPENED', incidentKind: 'ROUTE', criticality: 'MEDIUM', notify: false });
  });

  it('dos servicios del mismo servidor con el mismo parentIncidentId → un solo OPENED con los dos nombres y la criticidad más alta', () => {
    const prev = [row(2, { criticality: 'LOW' }), row(1, { criticality: 'MEDIUM' })];
    const next = [
      row(2, { status: 'DOWN', incidentId: 7, parentIncidentId: 9, criticality: 'LOW' }),
      row(1, { status: 'DOWN', incidentId: 8, parentIncidentId: 9, criticality: 'MEDIUM' }),
    ];
    const ev = diffStates(prev, next);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      kind: 'INCIDENT_OPENED',
      incidentKey: 9,
      serviceNames: ['svc-1', 'svc-2'],
      criticality: 'MEDIUM',
      notify: false,
    });
  });

  it('recuperar → un INCIDENT_RECOVERED con los datos del incidente', () => {
    const prev = [row(1, { status: 'DOWN', incidentId: 5, ticketCode: 'KT-1' }), row(2, { status: 'DOWN', incidentId: 6, parentIncidentId: 5 })];
    const ev = diffStates(prev, [row(1), row(2)]);
    expect(ev).toEqual([
      {
        kind: 'INCIDENT_RECOVERED',
        incidentKey: 5,
        incidentKind: 'DOWN',
        serverName: 'srv-a',
        serviceNames: ['svc-1', 'svc-2'],
        criticality: 'HIGH',
        ticketCode: 'KT-1',
        notify: true,
      },
    ]);
  });

  it('una clave que desaparece del estado → RECOVERED', () => {
    const ev = diffStates([row(1, { status: 'ROUTE', incidentId: 5 })], []);
    expect(ev.map((e) => e.kind)).toEqual(['INCIDENT_RECOVERED']);
  });

  it('ROUTE → DOWN de la misma clave → INCIDENT_UPGRADED', () => {
    const ev = diffStates([row(1, { status: 'ROUTE', incidentId: 5 })], [row(1, { status: 'DOWN', incidentId: 5 })]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'INCIDENT_UPGRADED', incidentKey: 5, incidentKind: 'DOWN', notify: true });
  });

  it('sin cambios → ningún evento', () => {
    const s = [row(1, { status: 'DOWN', incidentId: 5 }), row(2, { status: 'DEGRADED' })];
    expect(diffStates(s, s.map((r) => ({ ...r })))).toEqual([]);
  });

  it('DEGRADED → DEGRADED_STARTED con notify false; y al volver a OK, DEGRADED_CLEARED', () => {
    const started = diffStates([row(1)], [row(1, { status: 'DEGRADED' })]);
    expect(started).toEqual([
      {
        kind: 'DEGRADED_STARTED',
        incidentKey: null,
        incidentKind: 'DEGRADED',
        serverName: 'srv-a',
        serviceNames: ['svc-1'],
        criticality: 'HIGH',
        ticketCode: null,
        notify: false,
      },
    ]);
    const cleared = diffStates([row(1, { status: 'DEGRADED' })], [row(1)]);
    expect(cleared.map((e) => [e.kind, e.notify])).toEqual([['DEGRADED_CLEARED', false]]);
  });
});
