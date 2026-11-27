import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';

import { encryptSecret } from '../../common/crypto/aes-gcm.util';
import { FixedWindowLimiter } from '../../common/rate-limit/fixed-window-limiter';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { TicketsRealtimeGateway } from '../tickets/tickets-realtime.gateway';
import { DevApiController } from './dev-api.controller';
import { DevApiService } from './dev-api.service';
import { DevConnectorRepository } from './dev-connector.repository';
import { DevKeyGuard, DevRateLimiter } from './dev-key.guard';
import { DevKeysService, DevPrincipal } from './dev-keys.service';
import { fingerprintDevKey } from './domain/dev-key';
import { GithubWebhookController } from './github-webhook.controller';
import { GithubWebhookService } from './github-webhook.service';

const CLAVE = 'kdev_' + 'z'.repeat(43);
const SECRET = 'd'.repeat(64);
const P: DevPrincipal = {
  keyId: 1, userId: 9, userName: 'Ana', repoId: 3, repoFullName: 'cobrosseguros/cobranza',
  clientSystemId: 11, clientId: 4, clientName: 'Cobros Seguros', systemName: 'Cobranza',
};

describe('conector de Claude (integración HTTP)', () => {
  let app: TestHttpApp;
  const pendientes = jest.fn().mockResolvedValue({ cliente: 'Cobros Seguros', sistema: 'Cobranza', total: 0, items: [] });
  const estado = jest.fn().mockResolvedValue({ codigo: 'KB-0210', estado: 'EN_ATENCION' });
  const upsertLink = jest.fn().mockResolvedValue(undefined);
  const persona = jest.fn().mockResolvedValue({ ok: true, nombre: 'Luis Gómez', correo: 'luis@kubo.pe' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DevApiController, GithubWebhookController],
      providers: [
        DevKeyGuard,
        GithubWebhookService,
        { provide: FixedWindowLimiter, useClass: DevRateLimiter },
        {
          provide: DevKeysService,
          useValue: { resolve: jest.fn(async (fp: string) => (fp === fingerprintDevKey(CLAVE) ? P : null)) },
        },
        { provide: DevApiService, useValue: { pendientes, estado, persona } },
        {
          provide: DevConnectorRepository,
          useValue: {
            findRepoByFullName: jest.fn().mockResolvedValue({ id: 3, clientSystemId: 11, isActive: 1 }),
            findWebhookSecretEnc: jest.fn().mockResolvedValue(encryptSecret(SECRET)),
            findTicketByCode: jest.fn().mockResolvedValue({ id: 100, systemId: 11 }),
            findWorkItemByCode: jest.fn().mockResolvedValue(null),
            upsertLink,
          },
        },
        { provide: TicketsRealtimeGateway, useValue: { notifyChanged: jest.fn() } },
      ],
    }).compile();
    app = await startTestHttpApp(moduleRef);
  });

  afterAll(() => app.close());

  const conClave = (path: string, init: RequestInit = {}) =>
    app.raw(path, { ...init, headers: { 'X-Kubo-Dev-Key': CLAVE, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

  it('sin clave: 401', async () => {
    expect((await app.get('/dev/pendientes')).status).toBe(401);
  });

  it('clave desconocida: 401', async () => {
    const res = await app.raw('/dev/pendientes', { headers: { 'X-Kubo-Dev-Key': 'kdev_' + 'y'.repeat(43) } });
    expect(res.status).toBe(401);
  });

  it('con clave: 200 y el servicio recibe el principal', async () => {
    const res = await conClave('/dev/pendientes');
    expect(res.status).toBe(200);
    expect(pendientes).toHaveBeenCalledWith(P);
  });

  it('estado valida el cuerpo (estado obligatorio)', async () => {
    const res = await conClave('/dev/items/KB-0210/estado', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    const ok = await conClave('/dev/items/KB-0210/estado', { method: 'POST', body: JSON.stringify({ estado: 'EN_ATENCION' }) });
    expect(ok.status).toBe(201);
  });

  it('personas?q= resuelve a quién se asignaría (para la confirmación del MCP)', async () => {
    const res = await conClave('/dev/personas?q=gomez');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, nombre: 'Luis Gómez', correo: 'luis@kubo.pe' });
    expect(persona).toHaveBeenCalledWith('gomez');
    expect((await app.get('/dev/personas?q=gomez')).status).toBe(401);
  });

  describe('webhook', () => {
    // Espacios y orden propios: la firma se calcula sobre ESTOS bytes, no sobre un JSON re-serializado.
    const raw = '{ "ref": "refs/heads/fix/KB-0210",  "repository": {"full_name": "cobrosseguros/cobranza"}, "commits": [] }';
    const firma = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
    const enviar = (event: string, signature: string, body = raw) =>
      app.raw('/dev/github/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': event, 'X-Hub-Signature-256': signature },
        body,
      });

    it('verifica la firma sobre el cuerpo crudo y enlaza', async () => {
      const res = await enviar('push', firma);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ linked: 1 });
      expect(upsertLink).toHaveBeenCalledWith(expect.objectContaining({ kind: 'BRANCH', ticketId: 100 }));
    });

    it('firma mala: 401', async () => {
      expect((await enviar('push', 'sha256=' + '0'.repeat(64))).status).toBe(401);
    });

    it('evento no tratado (ping): 204', async () => {
      expect((await enviar('ping', firma)).status).toBe(204);
    });
  });
});
