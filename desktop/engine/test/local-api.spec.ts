import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { once } from 'node:events';
import type { EngineStatus } from '../src/engine';
import type { EngineEvent } from '../src/events/diff-states';
import { startLocalApi } from '../src/local-api';

const status: EngineStatus = {
  engine: { version: 'test', startedAt: '2026-11-23T15:00:00.000Z' },
  centralUrl: 'https://central.test',
  central: { reachable: true, lastSyncAt: '2026-11-23T15:00:15.000Z', consecutiveFailures: 0, rejecting: false },
  officeOutage: false,
  pending: 3,
  services: [],
  serverAlerts: [{ serverId: 3, serverName: 'srv-b', kind: 'DISK_LOW', detail: 'C: 9 % libre' }],
};

const allEvents: EngineEvent[] = Array.from({ length: 600 }, (_, i) => ({
  id: i + 1,
  at: '2026-11-24T10:00:00.000Z',
  kind: 'CENTRAL_BACK',
  incidentKey: null,
  incidentKind: null,
  serverName: null,
  serviceNames: [],
  criticality: null,
  ticketCode: null,
  serverId: null,
  alertKind: null,
  detail: null,
  notify: false,
}));

const fakeEngine = {
  calls: [] as [number, number][],
  status: () => status,
  events(after: number, limit: number) {
    this.calls.push([after, limit]);
    return { lastId: 600, events: allEvents.filter((e) => e.id > after).slice(0, limit) };
  },
};

describe('local-api', () => {
  let server: Server;
  let base: string;
  const SECRET = 'b'.repeat(64);
  const auth = { headers: { 'X-Kubo-Secret': SECRET } };

  beforeEach(async () => {
    fakeEngine.calls = [];
    server = startLocalApi(fakeEngine, { port: 0, secret: SECRET });
    await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.close();
    await once(server, 'close');
  });

  it('el servidor escucha en 127.0.0.1', () => {
    expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
  });

  it('sin secreto → 401', async () => {
    const res = await fetch(`${base}/v1/status`);
    expect(res.status).toBe(401);
  });

  it('secreto incorrecto (también de otra longitud) → 401', async () => {
    expect((await fetch(`${base}/v1/status`, { headers: { 'X-Kubo-Secret': 'a'.repeat(64) } })).status).toBe(401);
    expect((await fetch(`${base}/v1/status`, { headers: { 'X-Kubo-Secret': 'corto' } })).status).toBe(401);
  });

  it('con secreto → 200 con EngineStatus (incluido centralUrl)', async () => {
    const res = await fetch(`${base}/v1/status`, auth);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual(status);
  });

  it('cualquier otra ruta → 404', async () => {
    expect((await fetch(`${base}/v1/otra`, auth)).status).toBe(404);
    expect((await fetch(`${base}/v1/status`, { method: 'POST', headers: { 'X-Kubo-Secret': SECRET } })).status).toBe(404);
    expect((await fetch(`${base}/v1/events`, { method: 'POST', headers: { 'X-Kubo-Secret': SECRET } })).status).toBe(404);
  });

  describe('/v1/events', () => {
    it('sin secreto → 401 (y no consulta el diario)', async () => {
      expect((await fetch(`${base}/v1/events`)).status).toBe(401);
      expect((await fetch(`${base}/v1/events`, { headers: { 'X-Kubo-Secret': 'x' } })).status).toBe(401);
      expect(fakeEngine.calls).toEqual([]);
    });

    it('por defecto after=0 y limit=200; devuelve lastId y events', async () => {
      const res = await fetch(`${base}/v1/events`, auth);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { lastId: number; events: EngineEvent[] };
      expect(body.lastId).toBe(600);
      expect(body.events).toHaveLength(200);
      expect(body.events[0]).toEqual(allEvents[0]);
      expect(fakeEngine.calls).toEqual([[0, 200]]);
    });

    it('after y limit se respetan; limit se acota a 500', async () => {
      const body = (await (await fetch(`${base}/v1/events?after=10&limit=5`, auth)).json()) as { lastId: number; events: EngineEvent[] };
      expect(body.events.map((e) => e.id)).toEqual([11, 12, 13, 14, 15]);
      expect(body.lastId).toBe(600);
      const big = (await (await fetch(`${base}/v1/events?limit=10000`, auth)).json()) as { events: EngineEvent[] };
      expect(big.events).toHaveLength(500);
      expect(fakeEngine.calls).toEqual([
        [10, 5],
        [0, 500],
      ]);
    });

    it('after o limit inválidos → 400', async () => {
      for (const q of ['after=-1', 'after=abc', 'limit=0', 'limit=1.5', 'after=1e3']) {
        expect((await fetch(`${base}/v1/events?${q}`, auth)).status).toBe(400);
      }
      expect(fakeEngine.calls).toEqual([]);
    });
  });
});
