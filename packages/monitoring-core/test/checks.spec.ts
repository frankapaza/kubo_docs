import * as net from 'node:net';
import * as https from 'node:https';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { generate } from 'selfsigned';
import { runCheck, DEFAULT_TIMEOUTS_MS } from '../src/checks';
import type { ServiceTarget } from '../src/types';

const cycleAt = new Date('2026-11-23T15:00:00.000Z');
const svc = (p: Partial<ServiceTarget>): ServiceTarget => ({
  id: 1, protocol: 'TCP', target: '127.0.0.1', port: null, latencyThresholdMs: 1000, ...p,
});

let tcpServer: net.Server;
let tcpPort: number;
let httpsServer: https.Server;
let httpsPort: number;
let ca: string;

beforeAll(async () => {
  tcpServer = net.createServer((s) => s.end());
  await new Promise<void>((r) => tcpServer.listen(0, '127.0.0.1', r));
  tcpPort = (tcpServer.address() as AddressInfo).port;

  const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }],
  });
  ca = pems.cert;
  httpsServer = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    if (req.url === '/503') { res.statusCode = 503; res.end(); }
    else if (req.url === '/302') { res.statusCode = 302; res.setHeader('Location', '/ok'); res.end(); }
    else { res.statusCode = 200; res.end('ok'); }
  });
  await new Promise<void>((r) => httpsServer.listen(0, '127.0.0.1', r));
  httpsPort = (httpsServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => tcpServer.close(r));
  httpsServer.closeAllConnections?.();
  await new Promise((r) => httpsServer.close(r));
});

const url = (p: string) => `https://localhost:${httpsPort}${p}`;
const https_ = (p: string, o: object = {}) =>
  runCheck(svc({ protocol: 'HTTPS', target: url(p) }), 'REGULAR', cycleAt, o);

describe('TCP', () => {
  it('puerto que escucha -> ok true, errorCode null, durationMs >= 0', async () => {
    const r = await runCheck(svc({ port: tcpPort }), 'REGULAR', cycleAt);
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeNull();
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.httpStatus).toBeNull();
  });
  it('puerto cerrado -> REFUSED', async () => {
    const closed = await new Promise<number>((res) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => res(p)); });
    });
    const r = await runCheck(svc({ port: closed }), 'REGULAR', cycleAt);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('REFUSED');
  });
  it('host que no responde con timeout 300 ms -> TIMEOUT (o NETWORK si la red falla al instante)', async () => {
    const r = await runCheck(svc({ target: '10.255.255.1', port: 81 }), 'REGULAR', cycleAt, { timeoutsMs: { TCP: 300 } });
    expect(r.ok).toBe(false);
    expect(['TIMEOUT', 'NETWORK']).toContain(r.errorCode);
    expect(r.durationMs).toBeLessThan(1000);
  });
});

describe('HTTPS', () => {
  it('certificado autofirmado sin CA de confianza -> TLS', async () => {
    const r = await https_('/');
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('TLS');
  });
  it('200 con CA de confianza -> ok true', async () => {
    const r = await https_('/', { ca });
    expect(r).toMatchObject({ ok: true, errorCode: null, httpStatus: 200 });
  });
  it('503 -> HTTP_STATUS', async () => {
    const r = await https_('/503', { ca });
    expect(r).toMatchObject({ ok: false, errorCode: 'HTTP_STATUS', httpStatus: 503 });
  });
  it('302 -> ok true (sin seguir la redireccion)', async () => {
    const r = await https_('/302', { ca });
    expect(r).toMatchObject({ ok: true, errorCode: null, httpStatus: 302 });
  });
  it('URL invalida -> NETWORK, no lanza', async () => {
    const r = await runCheck(svc({ protocol: 'HTTPS', target: 'no es url' }), 'REGULAR', cycleAt);
    expect(r).toMatchObject({ ok: false, errorCode: 'NETWORK' });
  });
});

describe('DNS', () => {
  it('host inexistente -> DNS', async () => {
    const r = await runCheck(svc({ target: 'nohost.invalid', port: 80 }), 'REGULAR', cycleAt);
    expect(r).toMatchObject({ ok: false, errorCode: 'DNS' });
  });
  it('HTTPS host inexistente -> DNS', async () => {
    const r = await runCheck(svc({ protocol: 'HTTPS', target: 'https://nohost.invalid/' }), 'REGULAR', cycleAt);
    expect(r).toMatchObject({ ok: false, errorCode: 'DNS' });
  });
});

describe('ICMP', () => {
  let hasPing = true;
  try {
    execFileSync('ping', process.platform === 'win32' ? ['-n', '1', '127.0.0.1'] : ['-c', '1', '127.0.0.1'], { stdio: 'ignore' });
  } catch (e: any) {
    hasPing = e?.code !== 'ENOENT';
  }
  (hasPing ? it : it.skip)('127.0.0.1 -> ok true', async () => {
    const r = await runCheck(svc({ protocol: 'ICMP', target: '127.0.0.1' }), 'REGULAR', cycleAt);
    expect(r).toMatchObject({ ok: true, errorCode: null });
  });
  it('destino con forma de opcion no se interpreta como flag', async () => {
    const r = await runCheck(svc({ protocol: 'ICMP', target: '-f' }), 'REGULAR', cycleAt);
    expect(r.ok).toBe(false);
  });
});

describe('resultado', () => {
  it('UUID v4 nuevo, kind, cycleAt, serviceId, orderId y now inyectable', async () => {
    const now = () => new Date('2026-11-23T15:00:01.000Z');
    const a = await runCheck(svc({ id: 7, port: tcpPort }), 'RETRY', cycleAt, { orderId: 42, now });
    const b = await runCheck(svc({ id: 7, port: tcpPort }), 'RETRY', cycleAt);
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(a.id).toMatch(v4);
    expect(b.id).toMatch(v4);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ kind: 'RETRY', cycleAt: cycleAt.toISOString(), serviceId: 7, orderId: 42 });
    expect(a.startedAt).toBe('2026-11-23T15:00:01.000Z');
    expect(b.orderId).toBeNull();
  });
  it('DEFAULT_TIMEOUTS_MS', () => {
    expect(DEFAULT_TIMEOUTS_MS).toEqual({ TCP: 5000, HTTPS: 10000, ICMP: 5000 });
  });
});
