import { ExecutionContext, HttpException, UnauthorizedException } from '@nestjs/common';

import { FixedWindowLimiter } from '../../common/rate-limit/fixed-window-limiter';
import { DevKeyGuard, DevRequest, DEV_KEY_HEADER } from './dev-key.guard';
import { DevPrincipal } from './dev-keys.service';
import { fingerprintDevKey } from './domain/dev-key';

const CLAVE = 'kdev_' + 'a'.repeat(43);

const PRINCIPAL: DevPrincipal = {
  keyId: 5,
  userId: 9,
  userName: 'Ana Dev',
  repoId: 3,
  repoFullName: 'cobrosseguros/cobranza',
  clientSystemId: 11,
  clientId: 4,
  clientName: 'Cobros Seguros',
  systemName: 'Cobranza',
};

function ctx(req: Partial<DevRequest>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('DevKeyGuard', () => {
  const build = (resolved: DevPrincipal | null, limiter = new FixedWindowLimiter(60, 60_000)) => {
    const keys = { resolve: jest.fn().mockResolvedValue(resolved) };
    return { guard: new DevKeyGuard(keys as never, limiter), keys };
  };

  it('sin cabecera o mal formada responde 401 sin consultar la base', async () => {
    const { guard, keys } = build(PRINCIPAL);
    await expect(guard.canActivate(ctx({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(ctx({ headers: { [DEV_KEY_HEADER]: 'klog_' + 'a'.repeat(43) } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(keys.resolve).not.toHaveBeenCalled();
  });

  it('clave revocada o de repo inactivo responde 401', async () => {
    const { guard, keys } = build(null);
    await expect(guard.canActivate(ctx({ headers: { [DEV_KEY_HEADER]: CLAVE } }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(keys.resolve).toHaveBeenCalledWith(fingerprintDevKey(CLAVE));
  });

  it('clave válida deja el principal en la petición', async () => {
    const { guard } = build(PRINCIPAL);
    const req: Partial<DevRequest> = { headers: { [DEV_KEY_HEADER]: CLAVE } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.dev).toEqual(PRINCIPAL);
  });

  it('la petición 61 del minuto responde 429 con retryAfterSec', async () => {
    const { guard } = build(PRINCIPAL);
    for (let i = 0; i < 60; i++) await guard.canActivate(ctx({ headers: { [DEV_KEY_HEADER]: CLAVE } }));
    const err = await guard.canActivate(ctx({ headers: { [DEV_KEY_HEADER]: CLAVE } })).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(((err as HttpException).getResponse() as { retryAfterSec: number }).retryAfterSec).toBeGreaterThanOrEqual(1);
  });
});
