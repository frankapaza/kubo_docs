import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { ClientJwtGuard } from '../portal/guards/client-jwt.guard';
import { PortalApiKeysController, StaffApiKeysController } from './api-keys.controllers';
import { ApiKeysService } from './api-keys.service';

const VIEW = { id: 5, nombre: 'BI', prefijo: 'kci_abcd', estado: 'ACTIVA', creadaEn: '2026-11-27T10:00:00.000Z', ultimoUso: null, revocadaEn: null };

describe('Gestión de claves (HTTP)', () => {
  let app: TestHttpApp;
  let clientUser: { clientUserId: number; clientId: number; email: string; isClientAdmin: boolean };
  const service = {
    list: jest.fn(async () => [VIEW]),
    issue: jest.fn(async () => ({ key: VIEW, secret: 'kci_' + 'x'.repeat(43) })),
    revoke: jest.fn(async () => ({ ...VIEW, estado: 'REVOCADA' })),
  };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [PortalApiKeysController, StaffApiKeysController],
      providers: [{ provide: ApiKeysService, useValue: service }],
    })
      .overrideGuard(ClientJwtGuard)
      .useValue({ canActivate: (c: ExecutionContext) => ((c.switchToHttp().getRequest().user = clientUser), true) })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (c: ExecutionContext) => ((c.switchToHttp().getRequest().user = { id: 3, email: 'a@k.pe', role: 'ADMIN' }), true) })
      .overrideGuard(StaffOnlyGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = await startTestHttpApp(ref);
  });
  afterAll(() => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    clientUser = { clientUserId: 7, clientId: 10, email: 'c@cli.pe', isClientAdmin: true };
  });

  it('un usuario del portal que no es administrador -> 403', async () => {
    clientUser.isClientAdmin = false;
    expect((await app.raw('/portal/integraciones/claves', { method: 'GET' })).status).toBe(403);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('el administrador lista las claves de su empresa (clientId del token) sin secreto ni hash', async () => {
    const res = await app.raw('/portal/integraciones/claves', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(/secret|keyHash|key_hash/);
    expect(service.list).toHaveBeenCalledWith(10);
  });

  it('crear devuelve la clave en claro una vez y usa el clientId del token, no del cuerpo', async () => {
    const res = await app.raw('/portal/integraciones/claves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Power BI' }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).secret).toMatch(/^kci_/);
    expect(service.issue).toHaveBeenCalledWith(10, 'Power BI', { clientUserId: 7 });
  });

  it('un clientId en el cuerpo se rechaza (lista blanca)', async () => {
    const res = await app.raw('/portal/integraciones/claves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'x', clientId: 99 }),
    });
    expect(res.status).toBe(400);
    expect(service.issue).not.toHaveBeenCalled();
  });

  it('panel: el ADMIN crea y revoca en el cliente de la URL', async () => {
    const c = await app.raw('/clients/22/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'BI' }) });
    expect(c.status).toBe(201);
    expect(service.issue).toHaveBeenCalledWith(22, 'BI', { userId: 3 });
    const r = await app.raw('/clients/22/api-keys/5/revoke', { method: 'POST' });
    expect(r.status).toBe(200);
    expect(service.revoke).toHaveBeenCalledWith(22, 5, { userId: 3 });
  });
});
