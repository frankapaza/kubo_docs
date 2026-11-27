import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineClient } from '../src/main/engine-client';

const STATUS = { engine: { version: '1', startedAt: 'x' }, centralUrl: 'https://c', central: { reachable: true, lastSyncAt: null, consecutiveFailures: 0, rejecting: false }, officeOutage: false, pending: 0, services: [] };

function homeWithSecret(secret = '  abc123\r\n'): string {
  const dir = mkdtempSync(join(tmpdir(), 'kubo-widget-'));
  writeFileSync(join(dir, 'local-api.secret'), secret);
  return dir;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('EngineClient', () => {
  it('200 -> ok y envía X-Kubo-Secret recortado a 127.0.0.1', async () => {
    const fetchMock = jest.fn(async () => json(STATUS));
    const c = new EngineClient({ home: homeWithSecret(), port: 47801, fetch: fetchMock as unknown as typeof fetch });
    const r = await c.status();
    expect(r).toEqual({ kind: 'ok', status: STATUS });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:47801/v1/status');
    expect((init.headers as Record<string, string>)['X-Kubo-Secret']).toBe('abc123');
  });

  it('conexión rechazada: connecting a los 10 s, down a los 40 s', async () => {
    let t = 1_000_000;
    const fetchMock = jest.fn(async () => { throw new TypeError('fetch failed'); });
    const c = new EngineClient({ home: homeWithSecret(), port: 1, fetch: fetchMock as unknown as typeof fetch, now: () => t, startedAt: t });
    t += 10_000;
    expect(await c.status()).toEqual({ kind: 'connecting' });
    t += 30_000;
    expect(await c.status()).toEqual({ kind: 'down' });
  });

  it('secreto ilegible (EACCES) -> forbidden, cacheado 60 s, luego reintenta', async () => {
    let t = 5_000_000;
    const readSecret = jest.fn((): string => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
    const fetchMock = jest.fn(async () => json(STATUS));
    const c = new EngineClient({ home: 'x', port: 1, fetch: fetchMock as unknown as typeof fetch, now: () => t, startedAt: 0, readSecret });
    expect(await c.status()).toEqual({ kind: 'forbidden' });
    t += 30_000;
    expect(await c.status()).toEqual({ kind: 'forbidden' });
    expect(readSecret).toHaveBeenCalledTimes(1);
    t += 31_000;
    await c.status();
    expect(readSecret).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('EPERM también es forbidden; archivo ausente es down', async () => {
    const mk = (code: string) => new EngineClient({ home: 'x', port: 1, fetch: jest.fn() as unknown as typeof fetch, now: () => 9e9, startedAt: 0, readSecret: () => { throw Object.assign(new Error(code), { code }); } });
    expect(await mk('EPERM').status()).toEqual({ kind: 'forbidden' });
    expect(await mk('ENOENT').status()).toEqual({ kind: 'down' });
  });

  it('secreto ausente (ENOENT): connecting en el periodo de gracia, down después', async () => {
    let t = 100;
    const enoent = (): string => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); };
    const c = new EngineClient({ home: 'x', port: 1, fetch: jest.fn() as unknown as typeof fetch, now: () => t, startedAt: 100, readSecret: enoent });
    t += 5_000;
    expect(await c.status()).toEqual({ kind: 'connecting' });
    t += 40_000;
    expect(await c.status()).toEqual({ kind: 'down' });
  });

  it('401 y 403 -> forbidden; 500 -> down', async () => {
    const mk = (s: number) => new EngineClient({ home: homeWithSecret(), port: 1, fetch: (async () => json({}, s)) as unknown as typeof fetch, now: () => 9e9, startedAt: 0 });
    expect(await mk(401).status()).toEqual({ kind: 'forbidden' });
    expect(await mk(403).status()).toEqual({ kind: 'forbidden' });
    expect(await mk(500).status()).toEqual({ kind: 'down' });
  });

  it('events pide after y limit', async () => {
    const body = { lastId: 3, events: [] };
    const fetchMock = jest.fn(async () => json(body));
    const c = new EngineClient({ home: homeWithSecret(), port: 47800, fetch: fetchMock as unknown as typeof fetch });
    expect(await c.events(2, 50)).toEqual(body);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:47800/v1/events?after=2&limit=50');
    expect((init.headers as Record<string, string>)['X-Kubo-Secret']).toBe('abc123');
  });
});
