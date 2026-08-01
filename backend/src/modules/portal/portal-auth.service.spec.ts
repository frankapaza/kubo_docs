import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PortalAuthService } from './portal-auth.service';

// bcrypt es un addon nativo: sus propiedades no son configurables, así que
// `jest.spyOn(bcrypt, 'compare')` falla con "Cannot redefine property".
// Se envuelve `compare` en un jest.fn que delega en la implementación real,
// para poder comprobar que se invoca sin perder su comportamiento genuino.
jest.mock('bcrypt', () => {
  const actual = jest.requireActual('bcrypt');
  return { ...actual, compare: jest.fn(actual.compare) };
});

const makeService = (user: unknown) => {
  const repo = {
    findByEmail: jest.fn().mockResolvedValue(user),
    findById: jest.fn().mockResolvedValue(user),
    touchLastLogin: jest.fn().mockResolvedValue(undefined),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('tok'), verifyAsync: jest.fn() };
  const cfg = { get: jest.fn().mockReturnValue('secreto') };
  return { service: new PortalAuthService(repo as any, jwt as any, cfg as any), repo, jwt };
};

describe('login', () => {
  it('rechaza un correo que no existe', async () => {
    const { service } = makeService(null);
    await expect(service.login('nadie@x.com', 'x')).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza una contrasena incorrecta', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    await expect(service.login('a@x.com', 'incorrecta')).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza a un usuario desactivado aunque la contrasena sea correcta', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 0, isAdmin: 0 });
    await expect(service.login('a@x.com', 'correcta')).rejects.toThrow(UnauthorizedException);
  });

  it('devuelve el mismo error para correo inexistente y contrasena mala', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const a = makeService(null);
    const b = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    const errA = await a.service.login('nadie@x.com', 'x').catch((e: any) => e.message);
    const errB = await b.service.login('a@x.com', 'mala').catch((e: any) => e.message);
    expect(errA).toBe(errB);
  });

  it('firma el token con el clientId del usuario, no con uno de fuera', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service, jwt } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    await service.login('a@x.com', 'correcta');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 1, clientId: 7, isClientAdmin: false }),
      expect.anything(),
    );
  });

  it('sella last_login_at al entrar', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service, repo } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    await service.login('a@x.com', 'correcta');
    expect(repo.touchLastLogin).toHaveBeenCalledWith(1);
  });

  it('invoca bcrypt.compare tambien cuando el correo no existe, para no filtrar por tiempo', async () => {
    (bcrypt.compare as jest.Mock).mockClear();
    const { service } = makeService(null);
    await service.login('nadie@x.com', 'x').catch(() => undefined);
    expect(bcrypt.compare).toHaveBeenCalled();
  });
});
