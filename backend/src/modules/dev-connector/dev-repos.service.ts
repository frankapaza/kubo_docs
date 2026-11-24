import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { encryptSecret } from '../../common/crypto/aes-gcm.util';
import { isDuplicateEntry } from '../../common/db-errors';
import { ClientSystemsRepository } from '../tickets/client-systems.repository';
import { DevConnectorRepository } from './dev-connector.repository';
import { DevRepo } from './entities/dev-repo.entity';

export interface DevRepoView {
  id: number;
  clientSystemId: number;
  githubFullName: string;
  githubUrl: string;
  isActive: boolean;
  createdAt: string;
}

/** El secreto del webhook viaja en `secret` (lo tacha `AuditInterceptor`). Se muestra una vez. */
export interface IssuedRepoSecret {
  repo: DevRepoView;
  secret: string;
}

const OWNER_REPO = /^[a-z0-9-]+\/[a-z0-9._-]+$/;

/**
 * `owner/repo` en minúsculas a partir de lo que pegue el admin: el nombre o la
 * URL de clonado. GitHub no distingue mayúsculas, y el webhook trae
 * `repository.full_name` con las suyas: comparar en minúsculas evita que
 * `CobrosSeguros/Cobranza` y `cobrosseguros/cobranza` sean dos repos.
 */
export function normalizeGithubFullName(raw: string): string | null {
  const s = raw
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return OWNER_REPO.test(s) ? s : null;
}

@Injectable()
export class DevReposService {
  constructor(
    private readonly repo: DevConnectorRepository,
    private readonly clientSystems: ClientSystemsRepository,
  ) {}

  async list(clientSystemId?: number): Promise<DevRepoView[]> {
    return (await this.repo.listRepos(clientSystemId)).map(view);
  }

  async register(input: { clientSystemId: number; githubFullName: string }, actorUserId: number): Promise<IssuedRepoSecret> {
    const fullName = normalizeGithubFullName(input.githubFullName ?? '');
    if (!fullName) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Indica el repositorio como owner/repo (por ejemplo cobrosseguros/cobranza) o su URL de GitHub.',
      });
    }
    const cs = await this.clientSystems.findById(input.clientSystemId);
    if (!cs || !cs.isActive || !cs.systemId) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'La asignación cliente-sistema no existe, está inactiva o no tiene un producto del catálogo.',
      });
    }
    const secret = newWebhookSecret();
    try {
      const saved = await this.repo.createRepo({
        clientSystemId: input.clientSystemId,
        githubFullName: fullName,
        webhookSecretEnc: encryptSecret(secret),
        isActive: 1,
        createdBy: actorUserId,
      });
      return { repo: view(saved), secret };
    } catch (e) {
      if (isDuplicateEntry(e)) {
        throw new ConflictException({ code: 'CONFLICT', message: `El repositorio ${fullName} ya está registrado.` });
      }
      throw e;
    }
  }

  async setActive(id: number, isActive: boolean): Promise<DevRepoView> {
    await this.findOrFail(id);
    const updated = await this.repo.updateRepo(id, { isActive: isActive ? 1 : 0 });
    return view(updated!);
  }

  async regenerateWebhookSecret(id: number): Promise<IssuedRepoSecret> {
    await this.findOrFail(id);
    const secret = newWebhookSecret();
    const updated = await this.repo.updateRepo(id, { webhookSecretEnc: encryptSecret(secret) });
    return { repo: view(updated!), secret };
  }

  private async findOrFail(id: number): Promise<DevRepo> {
    const r = await this.repo.findRepoById(id);
    if (!r) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Repositorio no encontrado.' });
    return r;
  }
}

function newWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

function view(r: DevRepo): DevRepoView {
  return {
    id: Number(r.id),
    clientSystemId: Number(r.clientSystemId),
    githubFullName: r.githubFullName,
    githubUrl: `https://github.com/${r.githubFullName}`,
    isActive: Boolean(Number(r.isActive)),
    createdAt: new Date(r.createdAt ?? Date.now()).toISOString(),
  };
}
