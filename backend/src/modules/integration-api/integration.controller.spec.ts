import { Test } from '@nestjs/testing';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { ApiClientRateLimiter, ApiKeyGuard, ApiKeyRateLimiter } from './api-key.guard';
import { ApiKeysService } from './api-keys.service';
import { fingerprintApiKey, generateApiKey } from './domain/api-key';
import { IntegrationController } from './integration.controller';
import { IntegrationQueryService } from './integration-query.service';
import { IntegrationSummaryService } from './integration-summary.service';

describe('IntegrationController (HTTP, guarda real)', () => {
  let app: TestHttpApp;
  const key = generateApiKey();
  const keys = { resolve: jest.fn(async (fp: string) => (fp === fingerprintApiKey(key) ? { keyId: 1, clientId: 10 } : null)) };
  const query = {
    tickets: jest.fn(async () => ({ datos: [{ id: 1 }], siguienteCursor: null })),
    ticket: jest.fn(async () => ({ id: 1, historial: [] })),
    requerimientos: jest.fn(async () => ({ datos: [], siguienteCursor: null })),
    requerimiento: jest.fn(async () => ({ id: 3 })),
    sistemas: jest.fn(async () => []),
  };
  const summary = { resumen: jest.fn(async () => ({ abiertos: { porEstado: {}, porPrioridad: {} }, meses: [] })) };
  const auth = { Authorization: `Bearer ${key}` };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [IntegrationController],
      providers: [
        ApiKeyGuard,
        ApiKeyRateLimiter,
        ApiClientRateLimiter,
        { provide: ApiKeysService, useValue: keys },
        { provide: IntegrationQueryService, useValue: query },
        { provide: IntegrationSummaryService, useValue: summary },
      ],
    }).compile();
    app = await startTestHttpApp(ref);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('GET /integracion/tickets con clave -> 200 { datos, siguienteCursor } del cliente de la clave', async () => {
    const res = await app.raw('/integracion/tickets?estado=NUEVO&limite=10', { method: 'GET', headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ datos: [{ id: 1 }], siguienteCursor: null });
    expect(query.tickets).toHaveBeenCalledWith(10, { estados: ['NUEVO'], limite: 10 });
  });

  it('el código del detalle viaja tal cual y el cliente sale de la clave', async () => {
    await app.raw('/integracion/tickets/KB-0015', { method: 'GET', headers: auth });
    expect(query.ticket).toHaveBeenCalledWith(10, 'KB-0015');
  });

  it('sin clave -> 401; filtro inválido -> 400; un clientId en la query -> 400', async () => {
    expect((await app.raw('/integracion/tickets', { method: 'GET' })).status).toBe(401);
    expect((await app.raw('/integracion/tickets?estado=FOO', { method: 'GET', headers: auth })).status).toBe(400);
    expect((await app.raw('/integracion/tickets?clientId=2', { method: 'GET', headers: auth })).status).toBe(400);
    expect(query.tickets).not.toHaveBeenCalled();
  });

  it('GET /integracion/resumen?desde=2026-01&hasta=2026-03 -> 3 meses; mes inválido -> 400', async () => {
    const res = await app.raw('/integracion/resumen?desde=2026-01&hasta=2026-03', { method: 'GET', headers: auth });
    expect(res.status).toBe(200);
    expect(summary.resumen).toHaveBeenCalledWith(10, [{ year: 2026, month: 1 }, { year: 2026, month: 2 }, { year: 2026, month: 3 }]);
    expect((await app.raw('/integracion/resumen?desde=2026-13', { method: 'GET', headers: auth })).status).toBe(400);
    expect((await app.raw('/integracion/resumen?desde=2026-01&desde=2026-02', { method: 'GET', headers: auth })).status).toBe(400);
  });

  it('formato=csv: texto CSV con BOM, cabecera y cursor en X-Siguiente-Cursor; formato=xml -> 400', async () => {
    query.tickets.mockResolvedValueOnce({ datos: [{ id: 1, codigo: 'KB-1', slaEnRiesgo: false } as any], siguienteCursor: 'abc' as any });
    const res = await app.raw('/integracion/tickets?formato=csv&limite=5000', { method: 'GET', headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('x-siguiente-cursor')).toBe('abc');
    // fetch quita el BOM al decodificar: se miran los bytes crudos.
    const bytes = Buffer.from(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8').startsWith('"id";"codigo";"asunto"')).toBe(true);
    expect(query.tickets).toHaveBeenCalledWith(10, { limite: 5000 });
    expect((await app.raw('/integracion/tickets?formato=xml', { method: 'GET', headers: auth })).status).toBe(400);
    expect((await app.raw('/integracion/tickets?limite=5000', { method: 'GET', headers: auth })).status).toBe(400);
  });

  it('POST, PUT o DELETE sobre la API -> 405', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await app.raw('/integracion/tickets', { method, headers: auth });
      expect(res.status).toBe(405);
    }
  });
});
