import { Test } from '@nestjs/testing';
import { gzipSync } from 'zlib';

import { startTestHttpApp, TestHttpApp } from '../../../test-utils/test-http-app';
import { ClientsRepository } from '../../clients/clients.repository';
import { TicketsRealtimeGateway } from '../../tickets/tickets-realtime.gateway';
import { fingerprintInstallationKey } from '../domain/installation-key';
import { ErrorGroupsService } from '../error-groups.service';
import { InstallationsService, ResolvedInstallation } from '../installations.service';
import { LokiClient } from '../loki/loki.client';
import { IngestController } from './ingest.controller';
import { IngestRateLimiter, INGEST_MAX_BATCHES_PER_WINDOW } from './ingest-rate-limiter';
import { IngestService } from './ingest.service';
import { InstallationKeyGuard } from './installation-key.guard';
import { RecentBatches } from './recent-batches';

/**
 * El contrato de recepción atravesando HTTP de verdad: cabecera, gzip, tope
 * del cuerpo DESCOMPRIMIDO, pipe global y forma del error. El controlador, la
 * guarda y el servicio de ingesta son los reales; Loki, MySQL y el socket van
 * simulados (son el lado de allá).
 */
const CLAVE = 'klog_' + 'a'.repeat(43);
const RUTA = '/ingest/logs';

const INSTALACION: ResolvedInstallation = {
  id: 3,
  kind: 'CLIENTE',
  clientId: 7,
  systemId: 2,
  minLevel: 'INFO',
  displayName: 'ACME · Facturador',
};

const lote = (over: Record<string, unknown> = {}) => ({
  loteId: 'b0b0b0b0-0000-0000-0000-000000000001',
  aplicativo: 'Facturador',
  servidor: 'SRV-01',
  appenderVersion: '1.0.0',
  descartados: 0,
  eventos: [
    { ts: new Date().toISOString(), nivel: 'INFO', logger: 'X', mensaje: 'hola' },
    { ts: new Date().toISOString(), nivel: 'DEBUG', logger: 'X', mensaje: 'ruido' },
  ],
  ...over,
});

describe('POST /ingest/logs (integración HTTP)', () => {
  let app: TestHttpApp;
  let limiter: IngestRateLimiter;
  const findActiveByFingerprint = jest.fn(async (fp: string) =>
    fp === fingerprintInstallationKey(CLAVE) ? INSTALACION : null,
  );
  const push = jest.fn().mockResolvedValue({ ok: true });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestController],
      providers: [
        IngestService,
        InstallationKeyGuard,
        IngestRateLimiter,
        RecentBatches,
        {
          provide: InstallationsService,
          useValue: { findActiveByFingerprint, touchSource: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: LokiClient, useValue: { push } },
        { provide: ErrorGroupsService, useValue: { recordOccurrences: jest.fn().mockResolvedValue(undefined) } },
        { provide: ClientsRepository, useValue: { findByRuc: jest.fn().mockResolvedValue(null) } },
        { provide: TicketsRealtimeGateway, useValue: { publishLogLines: jest.fn() } },
      ],
    }).compile();
    limiter = moduleRef.get(IngestRateLimiter);
    app = await startTestHttpApp(moduleRef);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    findActiveByFingerprint.mockClear();
    push.mockClear();
  });

  const enviar = (body: Buffer | string, headers: Record<string, string> = {}) =>
    app.raw(RUTA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : new Uint8Array(body),
    });

  it('sin cabecera → 401', async () => {
    const res = await enviar(JSON.stringify(lote()));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ code: 'UNAUTHORIZED', message: 'Clave de instalación inválida o revocada.' });
    expect(findActiveByFingerprint).not.toHaveBeenCalled();
  });

  it('clave mal formada → 401 sin consultar la base', async () => {
    const res = await enviar(JSON.stringify(lote()), { 'X-Kubo-Log-Key': 'klog_corta' });
    expect(res.status).toBe(401);
    expect(findActiveByFingerprint).not.toHaveBeenCalled();
  });

  it('clave bien formada pero desconocida o revocada → 401 con el mismo mensaje', async () => {
    const res = await enviar(JSON.stringify(lote()), { 'X-Kubo-Log-Key': 'klog_' + 'b'.repeat(43) });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe('Clave de instalación inválida o revocada.');
    expect(findActiveByFingerprint).toHaveBeenCalledTimes(1);
  });

  it('clave válida → 202 { aceptados }', async () => {
    const res = await enviar(JSON.stringify(lote()), { 'X-Kubo-Log-Key': CLAVE });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ aceptados: 1, descartadosPorNivel: 1 });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('cuerpo gzip → 202 con el mismo resultado', async () => {
    const res = await enviar(gzipSync(Buffer.from(JSON.stringify(lote({ loteId: 'gz-1' })))), {
      'X-Kubo-Log-Key': CLAVE,
      'Content-Encoding': 'gzip',
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ aceptados: 1, descartadosPorNivel: 1 });
  });

  it('un cuerpo de 1,5 MB entra (el tope de la ruta no es el de 100 KB de express)', async () => {
    const grande = lote({
      loteId: 'grande-1',
      eventos: Array.from({ length: 60 }, () => ({ ts: new Date().toISOString(), nivel: 'INFO', logger: 'X', mensaje: 'x'.repeat(25_000) })),
    });
    const res = await enviar(JSON.stringify(grande), { 'X-Kubo-Log-Key': CLAVE });
    expect(res.status).toBe(202);
  });

  it('cuerpo de 2,5 MB descomprimido → 413 aunque comprimido ocupe poco', async () => {
    const enorme = JSON.stringify(
      lote({ eventos: Array.from({ length: 106 }, () => ({ nivel: 'INFO', logger: 'X', mensaje: 'x'.repeat(25_000) })) }),
    );
    expect(enorme.length).toBeGreaterThan(2.5 * 1024 * 1024);
    const comprimido = gzipSync(Buffer.from(enorme));
    expect(comprimido.length).toBeLessThan(100_000);
    const res = await enviar(comprimido, { 'X-Kubo-Log-Key': CLAVE, 'Content-Encoding': 'gzip' });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(push).not.toHaveBeenCalled();

    const plano = await enviar(enorme, { 'X-Kubo-Log-Key': CLAVE });
    expect(plano.status).toBe(413);
  });

  it('campo desconocido en el cuerpo → 202 (no VALIDATION_ERROR)', async () => {
    const res = await enviar(JSON.stringify({ ...lote({ loteId: 'nuevo-1' }), campoDelFuturo: { x: 1 } }), {
      'X-Kubo-Log-Key': CLAVE,
    });
    expect(res.status).toBe(202);
  });

  it('un cuerpo sin "eventos" → 400 con { code, message }', async () => {
    const res = await enviar(JSON.stringify({ aplicativo: 'A', servidor: 'B' }), { 'X-Kubo-Log-Key': CLAVE });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.code).toBe('string');
    expect(typeof body.message).toBe('string');
  });

  it('Loki caído → 503 para que el appender reintente', async () => {
    push.mockResolvedValueOnce({ ok: false, retryable: true, status: 502, message: 'bad gateway' });
    const res = await enviar(JSON.stringify(lote({ loteId: 'caido-1' })), { 'X-Kubo-Log-Key': CLAVE });
    expect(res.status).toBe(503);
  });

  it('lote 601 del minuto → 429 con Retry-After', async () => {
    // Las 600 primeras van directas al limitador: 600 peticiones HTTP no prueban nada más.
    const now = Date.now();
    for (let i = 0; i < INGEST_MAX_BATCHES_PER_WINDOW; i++) limiter.take(INSTALACION.id, now);
    const res = await enviar(JSON.stringify(lote({ loteId: 'ritmo-1' })), { 'X-Kubo-Log-Key': CLAVE });
    expect(res.status).toBe(429);
    const retry = Number(res.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
    expect(await res.json()).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});
