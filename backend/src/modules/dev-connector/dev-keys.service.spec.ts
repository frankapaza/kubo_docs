import { BadRequestException, NotFoundException } from '@nestjs/common';

import { DevKeysService } from './dev-keys.service';
import { fingerprintDevKey } from './domain/dev-key';

const FILA = {
  keyId: 5,
  userId: 9,
  userName: 'Ana Dev',
  repoId: 3,
  repoFullName: 'cobrosseguros/cobranza',
  clientSystemId: 11,
  clientId: 4,
  clientName: 'Cobros Seguros',
  systemName: 'Cobranza',
  lastUsedAt: null as Date | null,
};

function build(over: Record<string, jest.Mock> = {}) {
  const repo = {
    findPrincipalByFingerprint: jest.fn().mockResolvedValue({ ...FILA }),
    touchKey: jest.fn().mockResolvedValue(undefined),
    findRepoById: jest.fn().mockResolvedValue({ id: 3, isActive: 1, githubFullName: 'cobrosseguros/cobranza' }),
    createKey: jest.fn().mockImplementation(async (d) => ({ id: 21, createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...d })),
    findKeyById: jest.fn(),
    revokeKey: jest.fn().mockResolvedValue(undefined),
    listKeysOfUser: jest.fn().mockResolvedValue([]),
    ...over,
  };
  return { service: new DevKeysService(repo as never), repo };
}

describe('DevKeysService', () => {
  it('resolve devuelve el principal sin campos internos', async () => {
    const { service } = build();
    const p = await service.resolve('f'.repeat(64), new Date());
    expect(p).toEqual({
      keyId: 5, userId: 9, userName: 'Ana Dev', repoId: 3, repoFullName: 'cobrosseguros/cobranza',
      clientSystemId: 11, clientId: 4, clientName: 'Cobros Seguros', systemName: 'Cobranza',
    });
  });

  it('resolve devuelve null si la base no da una clave activa', async () => {
    const { service } = build({ findPrincipalByFingerprint: jest.fn().mockResolvedValue(null) });
    expect(await service.resolve('f'.repeat(64), new Date())).toBeNull();
  });

  it('marca last_used_at como mucho una vez por minuto', async () => {
    const now = new Date('2026-11-24T10:00:00Z');
    const reciente = build({
      findPrincipalByFingerprint: jest.fn().mockResolvedValue({ ...FILA, lastUsedAt: new Date(now.getTime() - 30_000) }),
    });
    await reciente.service.resolve('x', now);
    expect(reciente.repo.touchKey).not.toHaveBeenCalled();

    const viejo = build({
      findPrincipalByFingerprint: jest.fn().mockResolvedValue({ ...FILA, lastUsedAt: new Date(now.getTime() - 61_000) }),
    });
    await viejo.service.resolve('x', now);
    expect(viejo.repo.touchKey).toHaveBeenCalledWith(5, now);
  });

  it('issue guarda solo la huella y devuelve la clave una vez en `secret`', async () => {
    const { service, repo } = build();
    const out = await service.issue(9, 3);
    expect(out.secret).toMatch(/^kdev_[A-Za-z0-9_-]{43}$/);
    const guardado = repo.createKey.mock.calls[0][0];
    expect(guardado.keyFingerprint).toBe(fingerprintDevKey(out.secret));
    expect(guardado.keyPrefix).toBe(out.secret.slice(0, 9));
    expect(JSON.stringify(guardado)).not.toContain(out.secret);
    expect(out.key.repoFullName).toBe('cobrosseguros/cobranza');
  });

  it('no emite claves para un repo inactivo o inexistente', async () => {
    const inactivo = build({ findRepoById: jest.fn().mockResolvedValue({ id: 3, isActive: 0 }) });
    await expect(inactivo.service.issue(9, 3)).rejects.toBeInstanceOf(BadRequestException);
    const nada = build({ findRepoById: jest.fn().mockResolvedValue(null) });
    await expect(nada.service.issue(9, 3)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revocar una clave ajena sin ser ADMIN responde 404', async () => {
    const { service, repo } = build({ findKeyById: jest.fn().mockResolvedValue({ id: 21, userId: 77, revokedAt: null }) });
    await expect(service.revoke({ id: 9, role: 'DEVELOPER' }, 21)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.revokeKey).not.toHaveBeenCalled();
  });

  it('ADMIN revoca cualquiera; el dueño la suya', async () => {
    const admin = build({ findKeyById: jest.fn().mockResolvedValue({ id: 21, userId: 77, revokedAt: null }) });
    await admin.service.revoke({ id: 1, role: 'ADMIN' }, 21);
    expect(admin.repo.revokeKey).toHaveBeenCalledWith(21, expect.any(Date));
    const dueno = build({ findKeyById: jest.fn().mockResolvedValue({ id: 21, userId: 9, revokedAt: null }) });
    await dueno.service.revoke({ id: 9, role: 'DEVELOPER' }, 21);
    expect(dueno.repo.revokeKey).toHaveBeenCalled();
  });
});
