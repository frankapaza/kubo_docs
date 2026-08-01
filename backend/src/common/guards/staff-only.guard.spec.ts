import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { StaffOnlyGuard } from './staff-only.guard';

const ctxWith = (user: unknown): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as ExecutionContext;

describe('StaffOnlyGuard', () => {
  const guard = new StaffOnlyGuard();

  it('deja pasar a un usuario del equipo', () => {
    expect(guard.canActivate(ctxWith({ id: 1, email: 'a@kubo.pe', role: 'ADMIN' }))).toBe(true);
  });

  it('rechaza a un usuario de cliente', () => {
    expect(() =>
      guard.canActivate(ctxWith({ clientUserId: 5, clientId: 7, email: 'x@cli.com' })),
    ).toThrow(ForbiddenException);
  });

  it('rechaza cualquier cosa que traiga clientId, aunque tambien traiga role', () => {
    expect(() =>
      guard.canActivate(ctxWith({ id: 1, role: 'ADMIN', clientId: 7 })),
    ).toThrow(ForbiddenException);
  });

  it('rechaza si no hay usuario en la peticion', () => {
    expect(() => guard.canActivate(ctxWith(undefined))).toThrow(ForbiddenException);
  });

  // La constraint global exige errores { code, message } con el mensaje en
  // español. Sin esta asercion, alguien podria pasarlo a ingles o quitar el
  // `code` y ningun test se enteraria.
  it('rechaza con la forma { code, message } y el mensaje en español', () => {
    try {
      guard.canActivate(ctxWith({ clientUserId: 5, clientId: 7, email: 'x@cli.com' }));
      throw new Error('se esperaba una ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toEqual({
        code: 'FORBIDDEN',
        message: 'Esta sección es solo para el equipo interno.',
      });
    }
  });
});
