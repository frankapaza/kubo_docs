import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { isDuplicateEntry } from '../../common/db-errors';
import { sameId } from '../../common/ids';
import { ClientsRepository } from '../clients/clients.repository';
import { ClientSystemsRepository } from '../tickets/client-systems.repository';
import { SystemsRepository } from '../tickets/systems.repository';
import { CreateInstallationDto, UpdateInstallationDto } from './dto/installation.dto';
import { LogInstallation } from './entities/log-installation.entity';
import {
  fingerprintInstallationKey,
  generateInstallationKey,
  keyDisplayPrefix,
} from './domain/installation-key';
import { LogLevel } from './domain/log-level';
import { InstallationsRepository } from './installations.repository';

/** Lo que la ingesta necesita saber de la clave que llegó. */
export interface ResolvedInstallation {
  id: number;
  kind: 'CLIENTE' | 'INTERNA';
  clientId: number | null;
  systemId: number | null;
  minLevel: LogLevel;
  displayName: string;
}

export interface InstallationView {
  id: number;
  kind: 'CLIENTE' | 'INTERNA';
  displayName: string;
  clientId: number | null;
  clientName: string | null;
  clientSystemId: number | null;
  systemId: number | null;
  systemName: string | null;
  minLevel: LogLevel;
  keyPrefix: string | null;
  keyStatus: 'ACTIVA' | 'REVOCADA' | 'SIN_CLAVE';
  keyCreatedAt: string | null;
  lastSeenAt: string | null;
  sources: Array<{ aplicativo: string; servidor: string; appenderVersion: string | null; lastSeenAt: string }>;
}

/**
 * La clave en claro viaja en un campo llamado literalmente `secret`: es el
 * nombre que `AuditInterceptor` tacha, y el interceptor guarda la respuesta de
 * todo POST. Con otro nombre la clave acabaría en `audit_log` y en cada
 * respaldo de la base.
 */
export interface IssuedKey {
  installation: InstallationView;
  secret: string;
}

/** Cliente y producto de una instalación ya resueltos contra sus tablas. */
interface Identity {
  clientId: number | null;
  clientName: string | null;
  systemId: number | null;
  systemName: string | null;
}

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

@Injectable()
export class InstallationsService {
  constructor(
    private readonly repo: InstallationsRepository,
    private readonly clientSystems: ClientSystemsRepository,
    private readonly systems: SystemsRepository,
    private readonly clients: ClientsRepository,
  ) {}

  async list(): Promise<InstallationView[]> {
    const rows = await this.repo.findAll();
    const sources = await this.repo.listSources(rows.map((r) => Number(r.id)));
    // Cachés por llamada: una lista de decenas de instalaciones repite
    // cliente y producto, y cada `findById` es una consulta.
    const cache = new Map<string, Promise<unknown>>();
    return Promise.all(rows.map((r) => this.toView(r, sources, cache)));
  }

  async create(dto: CreateInstallationDto, actorUserId: number): Promise<IssuedKey> {
    const base: Partial<LogInstallation> = {
      kind: dto.kind,
      minLevel: dto.minLevel ?? 'INFO',
      createdBy: actorUserId,
      clientSystemId: null,
      name: null,
      systemId: null,
    };

    if (dto.kind === 'CLIENTE') {
      if (!dto.clientSystemId) {
        throw new BadRequestException({ code: 'BAD_INPUT', message: 'Indica la asignación cliente-sistema.' });
      }
      const cs = await this.clientSystems.findById(dto.clientSystemId);
      if (!cs) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Asignación no encontrada' });
      }
      // Una fila que la migración 029 dejó sin producto no tiene a qué
      // asociar los logs ni qué mostrar como nombre.
      if (cs.systemId === null || cs.systemId === undefined) {
        throw new BadRequestException({
          code: 'BAD_INPUT',
          message: 'Esta asignación no tiene un producto del catálogo; corrígela antes de monitorearla.',
        });
      }
      if (await this.repo.findByClientSystemId(dto.clientSystemId)) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Esta asignación ya tiene una instalación de monitoreo.',
        });
      }
      base.clientSystemId = dto.clientSystemId;
    } else {
      const name = dto.name?.trim();
      if (!name) {
        throw new BadRequestException({ code: 'BAD_INPUT', message: 'Una instalación interna necesita un nombre.' });
      }
      if (dto.systemId) {
        if (!(await this.systems.findById(dto.systemId))) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sistema no encontrado' });
        }
        base.systemId = dto.systemId;
      }
      base.name = name;
    }

    const secret = generateInstallationKey();
    let row: LogInstallation;
    try {
      row = await this.repo.create({ ...base, ...this.keyColumns(secret) });
    } catch (e) {
      if (isDuplicateEntry(e)) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Esta asignación ya tiene una instalación de monitoreo.',
        });
      }
      throw e;
    }
    return { installation: await this.viewOf(row), secret };
  }

  /** Emite una clave nueva; la anterior deja de resolver porque su huella desaparece. */
  async regenerateKey(id: number): Promise<IssuedKey> {
    await this.findByIdOrFail(id);
    const secret = generateInstallationKey();
    const row = await this.repo.update(id, this.keyColumns(secret));
    return { installation: await this.viewOf(row!), secret };
  }

  /**
   * Revoca sin borrar la huella: así sigue siendo reconocible en pantalla
   * como «REVOCADA» y la instalación conserva su historial.
   */
  async revokeKey(id: number): Promise<InstallationView> {
    await this.findByIdOrFail(id);
    const row = await this.repo.update(id, { keyRevokedAt: new Date() });
    return this.viewOf(row!);
  }

  async update(id: number, dto: UpdateInstallationDto): Promise<InstallationView> {
    const current = await this.findByIdOrFail(id);
    const patch: Partial<LogInstallation> = {};
    if (dto.minLevel) patch.minLevel = dto.minLevel;
    if (dto.name !== undefined) {
      if (current.kind !== 'INTERNA') {
        throw new BadRequestException({
          code: 'BAD_INPUT',
          message: 'El nombre de una instalación de cliente sale de su asignación.',
        });
      }
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException({ code: 'BAD_INPUT', message: 'El nombre no puede quedar vacío.' });
      }
      patch.name = name;
    }
    const row = Object.keys(patch).length ? await this.repo.update(id, patch) : current;
    return this.viewOf(row!);
  }

  /**
   * La instalación a la que pertenece una clave, solo si sigue activa. Es el
   * punto de entrada de la ingesta: devuelve `null` (→ 401) para clave
   * desconocida, revocada, o de una CLIENTE cuya asignación ya no existe.
   */
  async findActiveByFingerprint(fingerprint: string): Promise<ResolvedInstallation | null> {
    const row = await this.repo.findByFingerprint(fingerprint);
    if (!row || row.keyRevokedAt) return null;
    const identity = await this.identityOf(row, new Map());
    if (!identity) return null;
    return {
      id: Number(row.id),
      kind: row.kind,
      clientId: identity.clientId,
      systemId: identity.systemId,
      minLevel: row.minLevel,
      displayName: this.displayName(row, identity),
    };
  }

  /** Registra que el par aplicativo+servidor envió, y refresca «visto por última vez». */
  async touchSource(
    installationId: number,
    aplicativo: string,
    servidor: string,
    appenderVersion: string | null,
    at: Date,
  ): Promise<void> {
    await this.repo.upsertSource(installationId, aplicativo, servidor, appenderVersion, at);
    await this.repo.touchInstallation(installationId, at);
  }

  /** Opciones de los filtros de la pantalla de logs (solo personal, sin rol). */
  async listSourceOptions(): Promise<{
    installations: Array<{ id: number; displayName: string; clientId: number | null; systemId: number | null }>;
    aplicativos: string[];
    servidores: string[];
  }> {
    const rows = await this.repo.findAll();
    const cache = new Map<string, Promise<unknown>>();
    const installations: Array<{ id: number; displayName: string; clientId: number | null; systemId: number | null }> = [];
    for (const r of rows) {
      const identity = await this.identityOf(r, cache);
      if (!identity) continue;
      installations.push({
        id: Number(r.id),
        displayName: this.displayName(r, identity),
        clientId: identity.clientId,
        systemId: identity.systemId,
      });
    }
    const sources = await this.repo.listSources();
    const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
    return {
      installations,
      aplicativos: uniq(sources.map((s) => s.aplicativo)),
      servidores: uniq(sources.map((s) => s.servidor)),
    };
  }

  // ---------------------------------------------------------------- internos

  /** Las columnas de la clave: solo huella y prefijo; la clave en claro no se guarda. */
  private keyColumns(secret: string): Partial<LogInstallation> {
    return {
      keyFingerprint: fingerprintInstallationKey(secret),
      keyPrefix: keyDisplayPrefix(secret),
      keyCreatedAt: new Date(),
      keyRevokedAt: null,
    };
  }

  private async findByIdOrFail(id: number): Promise<LogInstallation> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Instalación no encontrada' });
    }
    return row;
  }

  private async viewOf(row: LogInstallation): Promise<InstallationView> {
    const sources = await this.repo.listSources([Number(row.id)]);
    return this.toView(row, sources, new Map());
  }

  /** Memoiza una consulta por clave dentro de una sola operación. */
  private memo<T>(cache: Map<string, Promise<unknown>>, key: string, load: () => Promise<T>): Promise<T> {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key) as Promise<T>;
  }

  /**
   * Cliente y producto de la instalación. En CLIENTE salen de la asignación
   * (única fuente de verdad); `null` si la asignación ya no existe o no tiene
   * producto, que es lo que hace que esa clave no resuelva.
   */
  private async identityOf(row: LogInstallation, cache: Map<string, Promise<unknown>>): Promise<Identity | null> {
    if (row.kind === 'CLIENTE') {
      const csId = Number(row.clientSystemId);
      const cs = await this.memo(cache, `cs:${csId}`, () => this.clientSystems.findById(csId));
      if (!cs || cs.systemId === null || cs.systemId === undefined) return null;
      const [client, system] = await Promise.all([
        this.memo(cache, `c:${cs.clientId}`, () => this.clients.findById(Number(cs.clientId))),
        this.memo(cache, `s:${cs.systemId}`, () => this.systems.findById(Number(cs.systemId))),
      ]);
      return {
        clientId: Number(cs.clientId),
        clientName: client?.razonSocial ?? null,
        systemId: Number(cs.systemId),
        systemName: system?.name ?? null,
      };
    }
    let systemName: string | null = null;
    if (row.systemId) {
      const sid = Number(row.systemId);
      systemName = (await this.memo(cache, `s:${sid}`, () => this.systems.findById(sid)))?.name ?? null;
    }
    return {
      clientId: null,
      clientName: null,
      systemId: row.systemId ? Number(row.systemId) : null,
      systemName,
    };
  }

  private displayName(row: LogInstallation, identity: Identity): string {
    if (row.kind === 'INTERNA') return row.name ?? '';
    return [identity.clientName, identity.systemName].filter(Boolean).join(' · ');
  }

  private async toView(
    row: LogInstallation,
    allSources: Array<{
      installationId: number;
      aplicativo: string;
      servidor: string;
      appenderVersion: string | null;
      lastSeenAt: Date;
    }>,
    cache: Map<string, Promise<unknown>>,
  ): Promise<InstallationView> {
    // Si la asignación faltara (no debería: la FK lo impide) la fila se lista
    // igual, sin cliente ni producto, para poder revocar su clave.
    const identity = (await this.identityOf(row, cache)) ?? {
      clientId: null,
      clientName: null,
      systemId: null,
      systemName: null,
    };
    const keyStatus: InstallationView['keyStatus'] = !row.keyFingerprint
      ? 'SIN_CLAVE'
      : row.keyRevokedAt
        ? 'REVOCADA'
        : 'ACTIVA';
    return {
      id: Number(row.id),
      kind: row.kind,
      displayName: this.displayName(row, identity),
      clientId: identity.clientId,
      clientName: identity.clientName,
      clientSystemId: row.clientSystemId ? Number(row.clientSystemId) : null,
      systemId: identity.systemId,
      systemName: identity.systemName,
      minLevel: row.minLevel,
      keyPrefix: row.keyPrefix,
      keyStatus,
      keyCreatedAt: iso(row.keyCreatedAt),
      lastSeenAt: iso(row.lastSeenAt),
      sources: allSources
        // Las fuentes llegan como cadena (bigint): comparar por valor.
        .filter((s) => sameId(s.installationId, row.id))
        .map((s) => ({
          aplicativo: s.aplicativo,
          servidor: s.servidor,
          appenderVersion: s.appenderVersion,
          lastSeenAt: new Date(s.lastSeenAt).toISOString(),
        })),
    };
  }
}
