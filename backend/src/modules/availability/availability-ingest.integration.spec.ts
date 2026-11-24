import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { AvailabilityIngestController } from './availability-ingest.controller';
import { AvailabilityIngestService } from './availability-ingest.service';
import { AvailabilitySyncService } from './availability-sync.service';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { ProbeRateLimiter } from './probe-rate-limiter';
import { ProbeTokenGuard } from './probe-token.guard';

const TOKEN = 'kmp_' + 'a'.repeat(43);
const PROBE = { id: 1, code: 'oficina-01', kind: 'OFFICE', tokenHash: createHash('sha256').update(TOKEN).digest('hex') };

const check = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  serviceId: 100,
  kind: 'REGULAR',
  cycleAt: '2026-11-23T15:00:00.000Z',
  startedAt: '2026-11-23T15:00:00.000Z',
  durationMs: 10,
  ok: true,
  errorCode: null,
  httpStatus: null,
  orderId: null,
});

describe('/ingest/probe (integración HTTP)', () => {
  let app: TestHttpApp;
  const acceptBatch = jest.fn(async () => ({ acceptedChecks: 1, duplicateChecks: 0, acceptedSignals: 0, duplicateSignals: 0 }));
  const sync = jest.fn(async () => ({ configVersion: 'v', config: null, orders: [], state: [] }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AvailabilityIngestController],
      providers: [
        ProbeTokenGuard,
        ProbeRateLimiter,
        { provide: AvailabilityIngestService, useValue: { acceptBatch } },
        { provide: AvailabilitySyncService, useValue: { sync } },
        {
          provide: getRepositoryToken(MonitorProbe),
          useValue: { findOne: async ({ where }: any) => (where.tokenHash === PROBE.tokenHash ? PROBE : null) },
        },
      ],
    }).compile();
    app = await startTestHttpApp(moduleRef);
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    acceptBatch.mockClear();
    sync.mockClear();
  });

  const body = (n: number) => ({ version: '1.0.0', checks: Array.from({ length: n }, (_, i) => check(i + 1)), signals: [] });

  it('un JWT de personal en vez del token de sonda -> 401', async () => {
    const jwt = sign({ sub: 1 }, 'x');
    const res = await app.post('/ingest/probe/batch', { token: jwt, body: body(1) });
    expect(res.status).toBe(401);
    expect(acceptBatch).not.toHaveBeenCalled();
  });

  it('sin cabecera -> 401 también en sync', async () => {
    expect((await app.get('/ingest/probe/sync')).status).toBe(401);
  });

  it('token válido y 1 check -> resumen del servicio', async () => {
    const res = await app.post('/ingest/probe/batch', { token: TOKEN, body: body(1) });
    expect([200, 201]).toContain(res.status);
    expect(res.body.acceptedChecks).toBe(1);
    expect(acceptBatch).toHaveBeenCalledTimes(1);
  });

  it('acepta la señal STATE_SYNC (resincronización de arranque de la sonda)', async () => {
    const signal = { id: '00000000-0000-4000-8000-0000000000aa', type: 'STATE_SYNC', serviceId: 100, at: '2026-11-23T15:00:00.000Z', firstFailureAt: null };
    const res = await app.post('/ingest/probe/batch', { token: TOKEN, body: { ...body(1), signals: [signal] } });
    expect([200, 201]).toContain(res.status);
    expect(acceptBatch).toHaveBeenCalledTimes(1);
  });

  it('token válido y 501 checks -> 400', async () => {
    const res = await app.post('/ingest/probe/batch', { token: TOKEN, body: body(501) });
    expect(res.status).toBe(400);
    expect(acceptBatch).not.toHaveBeenCalled();
  });

  it('cuerpo de más de 1 MB -> 413', async () => {
    const res = await app.post('/ingest/probe/batch', { token: TOKEN, body: { ...body(1), version: 'x'.repeat(1_100_000) } });
    expect(res.status).toBe(413);
  });

  it('sync pasa la configVersion', async () => {
    const res = await app.get('/ingest/probe/sync?configVersion=abc', { token: TOKEN });
    expect(res.status).toBe(200);
    expect(sync).toHaveBeenCalledWith(PROBE, 'abc');
  });

  it('pasado el tope de 60 lotes por minuto de la misma sonda -> 429 con Retry-After', async () => {
    let last = 0;
    let headers: Headers | undefined;
    for (let i = 0; i < 70 && last !== 429; i++) {
      const r = await app.post('/ingest/probe/batch', { token: TOKEN, body: body(1) });
      last = r.status;
      headers = r.headers;
    }
    expect(last).toBe(429);
    expect(Number(headers!.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });
});
