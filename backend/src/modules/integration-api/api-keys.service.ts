import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Client } from '../clients/entities/client.entity';
import { apiKeyDisplayPrefix, fingerprintApiKey, generateApiKey } from './domain/api-key';
import { ClientApiKey } from './entities/client-api-key.entity';

/** Claves activas como máximo por cliente (spec). */
export const MAX_ACTIVE_KEYS = 10;
/** Marcar «último uso» en cada petición sería una escritura por llamada: basta una por minuto. */
const TOUCH_EVERY_MS = 60_000;
/** Solo un cliente vigente usa la API: prospectos y ex clientes no. */
const ACTIVE_CLIENT_STATUS = 'CLIENT';

export interface ApiKeyView {
  id: number;
  nombre: string;
  prefijo: string;
  estado: 'ACTIVA' | 'REVOCADA';
  creadaEn: string;
  ultimoUso: string | null;
  revocadaEn: string | null;
}

/** La clave en claro viaja en `secret`: es el nombre que `AuditInterceptor` tacha. */
export interface IssuedApiKey {
  key: ApiKeyView;
  secret: string;
}

export interface ApiPrincipal {
  keyId: number;
  clientId: number;
}

/** Quién actúa: el personal (`userId`) o un administrador del cliente (`clientUserId`). */
export interface ApiKeyActor {
  userId?: number;
  clientUserId?: number;
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

export function toApiKeyView(k: ClientApiKey): ApiKeyView {
  return {
    id: Number(k.id),
    nombre: k.name,
    prefijo: k.keyPrefix,
    estado: k.revokedAt ? 'REVOCADA' : 'ACTIVA',
    creadaEn: iso(k.createdAt) as string,
    ultimoUso: iso(k.lastUsedAt),
    revocadaEn: iso(k.revokedAt),
  };
}

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ClientApiKey) private readonly keys: Repository<ClientApiKey>,
    @InjectRepository(Client) private readonly clients: Repository<Client>,
  ) {}

  async list(clientId: number): Promise<ApiKeyView[]> {
    const rows = await this.keys.find({ where: { clientId }, order: { createdAt: 'DESC', id: 'DESC' } });
    return rows.map(toApiKeyView);
  }

  async issue(clientId: number, name: string, actor: ApiKeyActor): Promise<IssuedApiKey> {
    const nombre = (name ?? '').trim();
    if (nombre.length < 1 || nombre.length > 80) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'El nombre de la clave debe tener entre 1 y 80 caracteres.' });
    }
    const client = await this.clients.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Cliente no encontrado.' });
    const active = await this.keys.count({ where: { clientId, revokedAt: IsNull() } });
    if (active >= MAX_ACTIVE_KEYS) {
      throw new ConflictException({
        code: 'LIMITE_CLAVES',
        message: `El cliente ya tiene ${MAX_ACTIVE_KEYS} claves activas. Revoca alguna antes de crear otra.`,
      });
    }
    const secret = generateApiKey();
    const saved = await this.keys.save(
      this.keys.create({
        clientId,
        name: nombre,
        keyPrefix: apiKeyDisplayPrefix(secret),
        keyHash: fingerprintApiKey(secret),
        createdByUserId: actor.userId ?? null,
        createdByClientUserId: actor.clientUserId ?? null,
        lastUsedAt: null,
        revokedAt: null,
        revokedByUserId: null,
        revokedByClientUserId: null,
      }),
    );
    return { key: toApiKeyView(saved), secret };
  }

  /** Revocar es inmediato. Una clave de otro cliente da el mismo 404 que una inexistente. */
  async revoke(clientId: number, keyId: number, actor: ApiKeyActor): Promise<ApiKeyView> {
    const key = await this.keys.findOne({ where: { id: keyId, clientId } });
    if (!key) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Clave no encontrada.' });
    if (!key.revokedAt) {
      key.revokedAt = new Date();
      key.revokedByUserId = actor.userId ?? null;
      key.revokedByClientUserId = actor.clientUserId ?? null;
      await this.keys.save(key);
    }
    return toApiKeyView(key);
  }

  /** Clave activa de un cliente vigente, o null. Marca el uso como mucho una vez por minuto. */
  async resolve(fingerprint: string, now: Date = new Date()): Promise<ApiPrincipal | null> {
    const key = await this.keys.findOne({ where: { keyHash: fingerprint, revokedAt: IsNull() } });
    if (!key) return null;
    const client = await this.clients.findOne({ where: { id: key.clientId }, select: { id: true, status: true } });
    if (!client || client.status !== ACTIVE_CLIENT_STATUS) return null;
    if (!key.lastUsedAt || now.getTime() - new Date(key.lastUsedAt).getTime() >= TOUCH_EVERY_MS) {
      await this.keys.update(key.id, { lastUsedAt: now });
    }
    return { keyId: Number(key.id), clientId: Number(key.clientId) };
  }
}
