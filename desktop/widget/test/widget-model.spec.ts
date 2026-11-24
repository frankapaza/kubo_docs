import { deriveModel } from '../src/shared/widget-model';
import type { CombinedStateRow, EngineStatus, ProbeView, TrackerState } from '../src/shared/types';

const NOW = new Date('2026-11-24T15:07:00Z'); // 10:07 en Lima

const pv = (state: TrackerState, at: string | null = '2026-11-24T15:06:30Z'): ProbeView => ({ state, lastCheckAt: at, lastLatencyMs: 10 });

function row(p: Partial<CombinedStateRow>): CombinedStateRow {
  return {
    serviceId: 1, serverId: 1, clientId: 1, serviceName: 'ERP', serverName: 'SRV-01', criticality: 'HIGH',
    office: pv('OK'), datacenter: pv('OK'), status: 'OK', incidentId: null, parentIncidentId: null, ticketCode: null, ...p,
  };
}

function status(services: CombinedStateRow[], over: Partial<EngineStatus> = {}): EngineStatus {
  return {
    engine: { version: '1', startedAt: '2026-11-24T00:00:00Z' }, centralUrl: 'https://c.example',
    central: { reachable: true, lastSyncAt: null, consecutiveFailures: 0, rejecting: false },
    officeOutage: false, pending: 0, services, ...over,
  };
}

const ok = (s: EngineStatus) => deriveModel({ kind: 'ok', status: s }, NOW);

describe('deriveModel', () => {
  it('connecting, down y forbidden son grises', () => {
    expect(deriveModel({ kind: 'connecting' }, NOW)).toMatchObject({ tone: 'grey', headline: 'Conectando con el motor…', rows: [], expanded: false });
    expect(deriveModel({ kind: 'down' }, NOW)).toMatchObject({ tone: 'grey', headline: 'El motor no responde' });
    expect(deriveModel({ kind: 'forbidden' }, NOW)).toMatchObject({ tone: 'grey', headline: 'Sin permiso para leer el monitor' });
  });

  it('sin problemas: ok, plegado, hora de Lima', () => {
    const m = ok(status([row({}), row({ serviceId: 2, status: 'NO_DATA' })]));
    expect(m).toMatchObject({ tone: 'ok', headline: 'KUBO · Todo operativo', time: '10:07', rows: [], expanded: false });
  });

  it('la hora de Lima es UTC-5 fija (cruce de día)', () => {
    const m = deriveModel({ kind: 'down' }, new Date('2026-11-24T03:05:00Z'));
    expect(m.time).toBe('22:05');
  });

  it('DOWN es rojo con detalle y ticket', () => {
    const m = ok(status([row({ status: 'DOWN', office: pv('FAILED'), datacenter: pv('OK'), incidentId: 7, ticketCode: 'KB-0007' })]));
    expect(m.tone).toBe('red');
    expect(m.expanded).toBe(true);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ tone: 'red', title: 'ERP', detail: 'Perú ✕ · Servidor ✓ · KB-0007', incidentId: 7, children: [] });
  });

  it('sin ticket se omite esa parte; ROUTE es rojo', () => {
    const m = ok(status([row({ status: 'ROUTE', office: pv('FAILED'), datacenter: pv('OK'), incidentId: 3 })]));
    expect(m.rows[0]).toMatchObject({ tone: 'red', detail: 'Perú ✕ · Servidor ✓' });
  });

  it('VERIFYING y DEGRADED son ámbar con sus marcas', () => {
    const m = ok(status([
      row({ serviceId: 1, status: 'VERIFYING', office: pv('VERIFYING'), datacenter: pv('OK') }),
      row({ serviceId: 2, serviceName: 'API', status: 'DEGRADED', office: pv('DEGRADED'), datacenter: pv('DEGRADED') }),
    ]));
    expect(m.tone).toBe('amber');
    expect(m.rows.map((r) => [r.tone, r.detail])).toEqual([['amber', 'Perú … · Servidor ✓'], ['amber', 'Perú ~ · Servidor ~']]);
  });

  it('vista nula, sin lastCheckAt o NO_DATA se marca –; una vista antigua se muestra tal cual', () => {
    const old = '2026-11-24T10:00:00Z';
    const m = ok(status([
      row({ serviceId: 1, status: 'DOWN', office: null, datacenter: pv('FAILED'), incidentId: 1 }),
      row({ serviceId: 2, status: 'DOWN', office: pv('FAILED', null), datacenter: pv('OK'), incidentId: 2 }),
      row({ serviceId: 3, status: 'DOWN', office: pv('FAILED', old), datacenter: pv('OK', old), incidentId: 3 }),
    ]));
    expect(m.rows.map((r) => r.detail)).toEqual(['Perú – · Servidor ✕', 'Perú – · Servidor ✓', 'Perú ✕ · Servidor ✓']);
    expect(ok(status([row({ status: 'NO_DATA', office: pv('OK'), datacenter: pv('OK') })])).tone).toBe('ok');
  });

  it('el detalle del servidor usa el peor hijo y el primer ticket no nulo', () => {
    const m = ok(status([
      row({ serviceId: 1, serviceName: 'A', status: 'DEGRADED', office: pv('DEGRADED'), datacenter: pv('OK'), incidentId: 11, parentIncidentId: 10, ticketCode: null }),
      row({ serviceId: 2, serviceName: 'B', status: 'DOWN', office: pv('FAILED'), datacenter: pv('FAILED'), incidentId: 12, parentIncidentId: 10, ticketCode: 'KB-0010' }),
    ]));
    expect(m.rows[0].detail).toBe('Perú ✕ · Servidor ✕ · KB-0010');
    expect(m.rows[0].tone).toBe('red');
  });

  it('un servidor con dos servicios es una fila con hijos', () => {
    const m = ok(status([
      row({ serviceId: 1, serviceName: 'ERP', status: 'DOWN', office: pv('FAILED'), datacenter: pv('FAILED'), incidentId: 11, parentIncidentId: 10, ticketCode: 'KB-0010' }),
      row({ serviceId: 2, serviceName: 'API', status: 'DOWN', office: pv('FAILED'), datacenter: pv('FAILED'), incidentId: 12, parentIncidentId: 10, ticketCode: 'KB-0010' }),
      row({ serviceId: 3, serverId: 2, serverName: 'SRV-02', serviceName: 'Web', status: 'DEGRADED', office: pv('DEGRADED'), incidentId: 20 }),
    ]));
    expect(m.rows).toHaveLength(2);
    const server = m.rows[0];
    expect(server).toMatchObject({ tone: 'red', title: 'SRV-01', incidentId: 10 });
    expect(server.children.map((c) => [c.title, c.incidentId])).toEqual([['ERP', 11], ['API', 12]]);
    expect(m.rows[1]).toMatchObject({ title: 'Web', tone: 'amber', children: [] });
  });

  it('central no alcanzable, rechazando y caída de oficina son filas ámbar', () => {
    const a = ok(status([], { central: { reachable: false, lastSyncAt: null, consecutiveFailures: 5, rejecting: false } }));
    expect(a.rows[0]).toMatchObject({ tone: 'amber', title: 'La central no responde', incidentId: null });
    const b = ok(status([], { central: { reachable: true, lastSyncAt: null, consecutiveFailures: 0, rejecting: true } }));
    expect(b.rows[0].title).toBe('La central rechaza los envíos');
    const c = ok(status([], { officeOutage: true }));
    expect(c).toMatchObject({ tone: 'amber', expanded: true });
    expect(c.rows[0].title).toBe('Sin internet en la oficina');
  });

  it('con el corte de rechazo abierto y la central respondiendo, dice «rechaza»', () => {
    const m = ok(status([], { central: { reachable: true, lastSyncAt: null, consecutiveFailures: 6, rejecting: true } }));
    expect(m.rows.map((r) => r.title)).toEqual(['La central rechaza los envíos']);
  });

  it('un fallo real de red tras el corte de rechazo (reachable false) dice «no responde»', () => {
    const m = ok(status([], { central: { reachable: false, lastSyncAt: null, consecutiveFailures: 9, rejecting: true } }));
    expect(m.rows.map((r) => r.title)).toEqual(['La central no responde']);
  });

  it('con caída de oficina tampoco se muestra la fila de la central aunque rechace', () => {
    const m = ok(status([], { officeOutage: true, central: { reachable: false, lastSyncAt: null, consecutiveFailures: 9, rejecting: true } }));
    expect(m.rows.map((r) => r.title)).toEqual(['Sin internet en la oficina']);
  });

  it('con caída de oficina no se muestra la fila de la central (un corte, una fila)', () => {
    const m = ok(status([], { officeOutage: true, central: { reachable: false, lastSyncAt: null, consecutiveFailures: 9, rejecting: false } }));
    expect(m.rows.map((r) => r.title)).toEqual(['Sin internet en la oficina']);
    expect(m.headline).toBe('KUBO · 1 problema');
  });

  it('el tono global es el peor: rojo sobre ámbar', () => {
    const m = ok(status([row({ status: 'DOWN', incidentId: 1, office: pv('FAILED') })], { officeOutage: true }));
    expect(m.tone).toBe('red');
    expect(m.rows[0].tone).toBe('red');
  });
});
