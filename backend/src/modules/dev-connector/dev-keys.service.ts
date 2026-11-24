import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { DevConnectorRepository, DevKeyRow } from './dev-connector.repository';
import { devKeyDisplayPrefix, fingerprintDevKey, generateDevKey } from './domain/dev-key';

/** Quién llama por el conector y cuál es su alcance. Lo deja la guarda en `req.dev`. */
export interface DevPrincipal {
  keyId: number;
  userId: number;
  userName: string;
  repoId: number;
  repoFullName: string;
  clientSystemId: number;
  clientId: number;
  clientName: string;
  systemName: string;
}

export interface DevKeyView {
  id: number;
  devRepoId: number;
  repoFullName: string;
  clientName: string;
  systemName: string;
  keyPrefix: string;
  status: 'ACTIVA' | 'REVOCADA';
  lastUsedAt: string | null;
  createdAt: string;
}

/**
 * La clave en claro viaja en `secret`: es el nombre que `AuditInterceptor`
 * tacha, y el interceptor guarda la respuesta de todo POST.
 */
export interface IssuedDevKey {
  key: DevKeyView;
  secret: string;
}

/** Marcar «último uso» en cada petición sería una escritura por llamada: basta una por minuto. */
const TOUCH_EVERY_MS = 60_000;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

@Injectable()
export class DevKeysService {
  constructor(private readonly repo: DevConnectorRepository) {}

  async resolve(fingerprint: string, now: Date = new Date()): Promise<DevPrincipal | null> {
    const row = await this.repo.findPrincipalByFingerprint(fingerprint);
    if (!row) return null;
    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= TOUCH_EVERY_MS) {
      await this.repo.touchKey(row.keyId, now);
    }
    const { lastUsedAt: _ignored, ...principal } = row;
    return principal;
  }

  async issue(userId: number, devRepoId: number): Promise<IssuedDevKey> {
    const repo = await this.repo.findRepoById(devRepoId);
    if (!repo || !repo.isActive) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'El repositorio no existe o está desactivado.' });
    }
    const secret = generateDevKey();
    const saved = await this.repo.createKey({
      devRepoId,
      userId,
      keyFingerprint: fingerprintDevKey(secret),
      keyPrefix: devKeyDisplayPrefix(secret),
    });
    const mine = (await this.repo.listKeysOfUser(userId)).find((k) => k.id === Number(saved.id));
    const key: DevKeyView = mine
      ? this.view(mine)
      : {
          id: Number(saved.id),
          devRepoId,
          repoFullName: repo.githubFullName,
          clientName: '',
          systemName: '',
          keyPrefix: saved.keyPrefix,
          status: 'ACTIVA',
          lastUsedAt: null,
          createdAt: new Date(saved.createdAt ?? Date.now()).toISOString(),
        };
    return { key, secret };
  }

  async listMine(userId: number): Promise<DevKeyView[]> {
    return (await this.repo.listKeysOfUser(userId)).map((k) => this.view(k));
  }

  /** El dueño revoca la suya; `ADMIN`, cualquiera. Lo ajeno da 404, igual que lo inexistente. */
  async revoke(actor: { id: number; role: string }, keyId: number): Promise<void> {
    const key = await this.repo.findKeyById(keyId);
    if (!key || (actor.role !== 'ADMIN' && Number(key.userId) !== Number(actor.id))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Clave no encontrada.' });
    }
    if (key.revokedAt) return;
    await this.repo.revokeKey(keyId, new Date());
  }

  private view(k: DevKeyRow): DevKeyView {
    return {
      id: k.id,
      devRepoId: k.devRepoId,
      repoFullName: k.repoFullName,
      clientName: k.clientName,
      systemName: k.systemName,
      keyPrefix: k.keyPrefix,
      status: k.revokedAt ? 'REVOCADA' : 'ACTIVA',
      lastUsedAt: iso(k.lastUsedAt),
      createdAt: k.createdAt.toISOString(),
    };
  }
}
