import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { decryptSecret } from '../../common/crypto/aes-gcm.util';
import { DevReposService } from './dev-repos.service';

function build(over: Record<string, jest.Mock> = {}) {
  const repo = {
    createRepo: jest.fn().mockImplementation(async (d) => ({ id: 3, isActive: 1, createdAt: new Date(), ...d })),
    findRepoById: jest.fn().mockResolvedValue({ id: 3, clientSystemId: 11, githubFullName: 'cobrosseguros/cobranza', isActive: 1 }),
    updateRepo: jest.fn().mockImplementation(async (id, d) => ({ id, clientSystemId: 11, githubFullName: 'cobrosseguros/cobranza', isActive: 1, ...d })),
    listRepos: jest.fn().mockResolvedValue([]),
    ...over,
  };
  const clientSystems = {
    findById: jest.fn().mockResolvedValue({ id: 11, clientId: 4, systemId: 2, isActive: 1 }),
  };
  return { service: new DevReposService(repo as never, clientSystems as never), repo, clientSystems };
}

describe('DevReposService', () => {
  it('guarda owner/repo en minúsculas y devuelve el secreto del webhook una vez', async () => {
    const { service, repo } = build();
    const out = await service.register({ clientSystemId: 11, githubFullName: ' CobrosSeguros/Cobranza ' }, 1);
    const datos = repo.createRepo.mock.calls[0][0];
    expect(datos.githubFullName).toBe('cobrosseguros/cobranza');
    expect(out.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(decryptSecret(datos.webhookSecretEnc)).toBe(out.secret);
    expect(JSON.stringify(out.repo)).not.toContain(out.secret);
  });

  it('acepta también la URL de GitHub', async () => {
    const { service, repo } = build();
    await service.register({ clientSystemId: 11, githubFullName: 'https://github.com/cobrosseguros/legal.git' }, 1);
    expect(repo.createRepo.mock.calls[0][0].githubFullName).toBe('cobrosseguros/legal');
  });

  it('rechaza nombres que no son owner/repo', async () => {
    const { service } = build();
    await expect(service.register({ clientSystemId: 11, githubFullName: 'cobranza' }, 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('un repo ya registrado responde 409', async () => {
    const dup = Object.assign(new Error('dup'), { errno: 1062 });
    const { service } = build({ createRepo: jest.fn().mockRejectedValue(dup) });
    await expect(service.register({ clientSystemId: 11, githubFullName: 'a/b' }, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('una asignación inexistente o sin producto del catálogo responde 400', async () => {
    const { service, clientSystems } = build();
    clientSystems.findById.mockResolvedValueOnce(null);
    await expect(service.register({ clientSystemId: 99, githubFullName: 'a/b' }, 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    clientSystems.findById.mockResolvedValueOnce({ id: 11, clientId: 4, systemId: null, isActive: 1 });
    await expect(service.register({ clientSystemId: 11, githubFullName: 'a/b' }, 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('quitar un repo lo borra con sus claves y vínculos y libera el nombre', async () => {
    const deleteRepoCascade = jest.fn().mockResolvedValue({ keys: 2, links: 5 });
    const { service } = build({ deleteRepoCascade });
    const out = await service.remove(3);
    expect(deleteRepoCascade).toHaveBeenCalledWith(3);
    expect(out).toEqual({ githubFullName: 'cobrosseguros/cobranza', clavesBorradas: 2, vinculosBorrados: 5 });
  });

  it('quitar un repo inexistente responde 404 sin borrar nada', async () => {
    const deleteRepoCascade = jest.fn();
    const { service } = build({ deleteRepoCascade, findRepoById: jest.fn().mockResolvedValue(null) });
    await expect(service.remove(99)).rejects.toBeInstanceOf(NotFoundException);
    expect(deleteRepoCascade).not.toHaveBeenCalled();
  });

  it('regenerar el secreto guarda uno nuevo cifrado', async () => {
    const { service, repo } = build();
    const out = await service.regenerateWebhookSecret(3);
    expect(decryptSecret(repo.updateRepo.mock.calls[0][1].webhookSecretEnc)).toBe(out.secret);
  });
});
