import { ForbiddenException } from '@nestjs/common';
import { ClientAdminGuard } from './client-admin.guard';

function ctx(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('ClientAdminGuard', () => {
  const guard = new ClientAdminGuard();

  it('deja pasar al administrador de la empresa', () => {
    expect(guard.canActivate(ctx({ clientUserId: 1, clientId: 7, isClientAdmin: true }))).toBe(true);
  });

  it('deniega a un usuario de cliente que no es administrador', () => {
    expect(() => guard.canActivate(ctx({ clientUserId: 1, clientId: 7, isClientAdmin: false })))
      .toThrow(ForbiddenException);
  });

  // Las tres siguientes son el punto de esta clase: la ausencia debe
  // significar «no». El defecto que más veces ha reaparecido en este proyecto
  // es decidir por la ausencia de un valor, y aquí se prueba explícitamente.
  it('deniega cuando el token no trae el campo', () => {
    expect(() => guard.canActivate(ctx({ clientUserId: 1, clientId: 7 })))
      .toThrow(ForbiddenException);
  });

  it('deniega cuando no hay usuario en la petición', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it('deniega cuando el campo llega con un valor que no es booleano', () => {
    // Un token manipulado puede traer cualquier cosa. Solo `true` pasa.
    expect(() => guard.canActivate(ctx({ isClientAdmin: 'true' }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx({ isClientAdmin: 1 }))).toThrow(ForbiddenException);
  });
});
