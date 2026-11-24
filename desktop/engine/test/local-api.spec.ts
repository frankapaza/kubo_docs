import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { once } from 'node:events';
import type { EngineStatus } from '../src/engine';
import { startLocalApi } from '../src/local-api';

const status: EngineStatus = {
  engine: { version: 'test', startedAt: '2026-11-23T15:00:00.000Z' },
  central: { reachable: true, lastSyncAt: '2026-11-23T15:00:15.000Z', consecutiveFailures: 0 },
  officeOutage: false,
  pending: 3,
  services: [],
};

describe('local-api', () => {
  let server: Server;
  let base: string;
  const SECRET = 'b'.repeat(64);

  beforeEach(async () => {
    server = startLocalApi({ status: () => status }, { port: 0, secret: SECRET });
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

  it('con secreto → 200 con EngineStatus', async () => {
    const res = await fetch(`${base}/v1/status`, { headers: { 'X-Kubo-Secret': SECRET } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual(status);
  });

  it('cualquier otra ruta → 404', async () => {
    expect((await fetch(`${base}/v1/otra`, { headers: { 'X-Kubo-Secret': SECRET } })).status).toBe(404);
    expect((await fetch(`${base}/v1/status`, { method: 'POST', headers: { 'X-Kubo-Secret': SECRET } })).status).toBe(404);
  });
});
