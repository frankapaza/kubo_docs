import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { AvailabilityStateController } from './availability-state.controller';
import { AvailabilityStateService } from './availability-state.service';

/**
 * Los filtros enteros opcionales pasan por el ValidationPipe global (transform)
 * antes que por el pipe del parámetro: sin filtro llega NaN y con filtro un
 * número. Antes se usaba ParseIntPipe({ optional: true }) y todas estas
 * llamadas daban 400, así que la pantalla Estado no cargaba nunca.
 */
describe('AvailabilityStateController (HTTP, filtros opcionales)', () => {
  let app: TestHttpApp;
  const service = {
    state: jest.fn(async () => []),
    listIncidents: jest.fn(async () => ({ items: [], truncated: false })),
  };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [AvailabilityStateController],
      providers: [{ provide: AvailabilityStateService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (c: ExecutionContext) => ((c.switchToHttp().getRequest().user = { id: 1, role: 'ADMIN' }), true) })
      .overrideGuard(StaffOnlyGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = await startTestHttpApp(ref);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('GET /availability/state sin filtros responde 200 con clientId y serverId sin definir', async () => {
    const res = await app.raw('/availability/state', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(service.state).toHaveBeenCalledWith({ clientId: undefined, status: undefined, serverId: undefined });
  });

  it('GET /availability/state?clientId=7 pasa el número', async () => {
    const res = await app.raw('/availability/state?clientId=7', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(service.state).toHaveBeenCalledWith({ clientId: 7, status: undefined, serverId: undefined });
  });

  it('GET /availability/state?clientId=1.5 da 400 (no es entero)', async () => {
    expect((await app.raw('/availability/state?clientId=1.5', { method: 'GET' })).status).toBe(400);
  });

  it('GET /availability/incidents sin filtros responde 200', async () => {
    const res = await app.raw('/availability/incidents', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(service.listIncidents).toHaveBeenCalledWith(expect.objectContaining({ limit: undefined, clientId: undefined, open: undefined }));
  });

  it('GET /availability/incidents?open=true&limit=50 pasa los valores', async () => {
    const res = await app.raw('/availability/incidents?open=true&limit=50', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(service.listIncidents).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, open: true }));
  });
});
