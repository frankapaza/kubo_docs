import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';

import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { WorkItemsController } from './work-items.controller';
import { WorkItemsService } from './work-items.service';
import { WorkItemBoardService } from './work-item-board.service';
import { WorkItemIntakeService } from './work-item-intake.service';

/**
 * Ronda de correcciones 1 de la tarea 9, punto 3: `@Matches` es la única
 * pieza de `AcceptWorkItemDto.committedDate` que impide que una fecha con
 * hora (`2026-09-30T10:00:00Z`) llegue a la columna `date` y se trunque en
 * silencio -- `@IsDateString` sola la deja pasar, porque valida ISO 8601 en
 * general y no solo la forma `YYYY-MM-DD`. `work-item-intake.service.spec.ts`
 * prueba el servicio con el DTO ya validado; nada probaba el decorador en sí,
 * así que quien lo borrara mañana dejaría la suite entera en verde.
 *
 * Va contra el ciclo HTTP completo con el `ValidationPipe` real —el mismo que
 * monta `main.ts`, vía `startTestHttpApp`— porque un test sobre la clase del
 * DTO no demuestra que el pipe global lo aplique de verdad al llegar por la
 * ruta. Mismo patrón que `portal-validation.integration.spec.ts` y
 * `auth-boundary.integration.spec.ts`: controlador real, guard real,
 * servicios mockeados (son el lado de allá de la frontera que se está
 * probando).
 */
const STAFF_SECRET = 'secreto-de-pruebas-del-personal-intake';
const STAFF_PAYLOAD = { sub: 1, email: 'jefa.proyecto@kubo.pe', role: 'ADMIN' };

describe('POST /work-items/:id/accept — formato de committedDate (integración HTTP)', () => {
  let app: TestHttpApp;
  let accept: jest.Mock;

  beforeAll(async () => {
    accept = jest.fn().mockResolvedValue({ id: 1, status: 'PENDIENTE' });

    const config = {
      get: (key: string, fallback?: string) => ({ JWT_ACCESS_SECRET: STAFF_SECRET })[key] ?? fallback,
    };

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [WorkItemsController],
      providers: [
        { provide: ConfigService, useValue: config },
        JwtStrategy,
        // `WorkItemsService` y `WorkItemBoardService` no participan en las
        // rutas que se prueban aquí, pero el controlador los pide en el
        // constructor: sin un doble, Nest no puede instanciarlo.
        { provide: WorkItemsService, useValue: {} },
        { provide: WorkItemBoardService, useValue: {} },
        { provide: WorkItemIntakeService, useValue: { accept, reject: jest.fn() } },
      ],
    }).compile();

    app = await startTestHttpApp(moduleRef);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    accept.mockClear();
  });

  const token = () =>
    new JwtService({}).sign(STAFF_PAYLOAD, { secret: STAFF_SECRET, expiresIn: '5m' });

  it('una fecha con hora se rechaza con 400 en español y no llega al servicio', async () => {
    const res = await app.post('/work-items/1/accept', {
      token: token(),
      body: { priority: 'ALTA', committedDate: '2026-09-30T10:00:00Z' },
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toContain('AAAA-MM-DD');
    expect(accept).not.toHaveBeenCalled();
  });

  it('una fecha sin separadores (20260930) se rechaza con 400 y no llega al servicio', async () => {
    const res = await app.post('/work-items/1/accept', {
      token: token(),
      body: { priority: 'ALTA', committedDate: '20260930' },
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(accept).not.toHaveBeenCalled();
  });

  it('una fecha con el formato AAAA-MM-DD sí llega al servicio', async () => {
    const res = await app.post('/work-items/1/accept', {
      token: token(),
      body: { priority: 'ALTA', committedDate: '2026-09-30' },
    });

    expect(res.status).toBe(201);
    expect(accept).toHaveBeenCalledWith(1, 1, { priority: 'ALTA', committedDate: '2026-09-30' });
  });
});
