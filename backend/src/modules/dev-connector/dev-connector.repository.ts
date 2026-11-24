import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DevKey } from './entities/dev-key.entity';
import { DevLink, DevLinkKind, DevLinkSource } from './entities/dev-link.entity';
import { DevRepo } from './entities/dev-repo.entity';

/** Una clave activa con todo lo que define su alcance, en una sola consulta. */
export interface PrincipalRow {
  keyId: number;
  userId: number;
  userName: string;
  repoId: number;
  repoFullName: string;
  clientSystemId: number;
  clientId: number;
  clientName: string;
  systemName: string;
  lastUsedAt: Date | null;
}

export interface DevKeyRow {
  id: number;
  devRepoId: number;
  repoFullName: string;
  clientName: string;
  systemName: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface UpsertLinkInput {
  devRepoId: number;
  ticketId: number | null;
  workItemId: number | null;
  kind: DevLinkKind;
  ref: string;
  title: string | null;
  url: string | null;
  authorLogin: string | null;
  state: string | null;
  source: DevLinkSource;
  occurredAt: Date;
}

@Injectable()
export class DevConnectorRepository {
  constructor(
    @InjectRepository(DevRepo) private readonly repos: Repository<DevRepo>,
    @InjectRepository(DevKey) private readonly keys: Repository<DevKey>,
    @InjectRepository(DevLink) private readonly links: Repository<DevLink>,
  ) {}

  /**
   * La clave solo vale si ella, su repo, la asignación y el producto siguen
   * activos y el usuario también: cualquier eslabón dado de baja la apaga sin
   * tener que revocarla a mano.
   */
  async findPrincipalByFingerprint(fingerprint: string): Promise<PrincipalRow | null> {
    const rows: Array<Record<string, unknown>> = await this.keys.query(
      `SELECT k.id AS keyId, k.user_id AS userId, u.full_name AS userName,
              r.id AS repoId, r.github_full_name AS repoFullName,
              cs.id AS clientSystemId, cs.client_id AS clientId,
              c.razon_social AS clientName, s.name AS systemName,
              k.last_used_at AS lastUsedAt
         FROM dev_keys k
         JOIN dev_repos r       ON r.id = k.dev_repo_id
         JOIN client_systems cs ON cs.id = r.client_system_id
         JOIN systems s         ON s.id = cs.system_id
         JOIN clients c         ON c.id = cs.client_id
         JOIN users u           ON u.id = k.user_id
        WHERE k.key_fingerprint = ?
          AND k.revoked_at IS NULL
          AND r.is_active = 1 AND cs.is_active = 1 AND u.is_active = 1
        LIMIT 1`,
      [fingerprint],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      keyId: Number(r.keyId),
      userId: Number(r.userId),
      userName: String(r.userName),
      repoId: Number(r.repoId),
      repoFullName: String(r.repoFullName),
      clientSystemId: Number(r.clientSystemId),
      clientId: Number(r.clientId),
      clientName: String(r.clientName),
      systemName: String(r.systemName),
      lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt as string) : null,
    };
  }

  async touchKey(keyId: number, at: Date): Promise<void> {
    await this.keys.update(keyId, { lastUsedAt: at });
  }

  createKey(data: Partial<DevKey>): Promise<DevKey> {
    return this.keys.save(this.keys.create(data));
  }

  findKeyById(id: number): Promise<DevKey | null> {
    return this.keys.findOne({ where: { id } });
  }

  async revokeKey(id: number, at: Date): Promise<void> {
    await this.keys.update(id, { revokedAt: at });
  }

  async listKeysOfUser(userId: number): Promise<DevKeyRow[]> {
    const rows: Array<Record<string, unknown>> = await this.keys.query(
      `SELECT k.id, k.dev_repo_id AS devRepoId, r.github_full_name AS repoFullName,
              c.razon_social AS clientName, COALESCE(s.name, cs.name) AS systemName,
              k.key_prefix AS keyPrefix, k.last_used_at AS lastUsedAt,
              k.revoked_at AS revokedAt, k.created_at AS createdAt
         FROM dev_keys k
         JOIN dev_repos r       ON r.id = k.dev_repo_id
         JOIN client_systems cs ON cs.id = r.client_system_id
         JOIN clients c         ON c.id = cs.client_id
         LEFT JOIN systems s    ON s.id = cs.system_id
        WHERE k.user_id = ?
        ORDER BY k.revoked_at IS NULL DESC, k.created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      devRepoId: Number(r.devRepoId),
      repoFullName: String(r.repoFullName),
      clientName: String(r.clientName),
      systemName: String(r.systemName ?? ''),
      keyPrefix: String(r.keyPrefix),
      lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt as string) : null,
      revokedAt: r.revokedAt ? new Date(r.revokedAt as string) : null,
      createdAt: new Date(r.createdAt as string),
    }));
  }

  // ── Repos ──────────────────────────────────────────────────────────────

  findRepoById(id: number): Promise<DevRepo | null> {
    return this.repos.findOne({ where: { id } });
  }

  findRepoByFullName(githubFullName: string): Promise<DevRepo | null> {
    return this.repos.findOne({ where: { githubFullName } });
  }

  /** El secreto cifrado no se selecciona por defecto (`select: false`). */
  async findWebhookSecretEnc(repoId: number): Promise<string | null> {
    const row = await this.repos
      .createQueryBuilder('r')
      .addSelect('r.webhookSecretEnc')
      .where('r.id = :id', { id: repoId })
      .getOne();
    return row?.webhookSecretEnc ?? null;
  }

  listRepos(clientSystemId?: number): Promise<DevRepo[]> {
    return this.repos.find({
      where: clientSystemId ? { clientSystemId } : {},
      order: { githubFullName: 'ASC' },
    });
  }

  createRepo(data: Partial<DevRepo>): Promise<DevRepo> {
    return this.repos.save(this.repos.create(data));
  }

  async updateRepo(id: number, data: Partial<DevRepo>): Promise<DevRepo | null> {
    await this.repos.update(id, data);
    return this.findRepoById(id);
  }

  // ── Vínculos de código ─────────────────────────────────────────────────

  /**
   * Un solo `INSERT … ON DUPLICATE KEY UPDATE`: el webhook y el MCP pueden
   * informar lo mismo, y una reentrega de GitHub no duplica. Un PR que cambia
   * de estado actualiza su fila.
   */
  async upsertLink(l: UpsertLinkInput): Promise<void> {
    await this.links.query(
      `INSERT INTO dev_links
         (dev_repo_id, ticket_id, work_item_id, kind, ref, title, url, author_login, state, source, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = COALESCE(VALUES(title), title),
         url = COALESCE(VALUES(url), url),
         author_login = COALESCE(VALUES(author_login), author_login),
         state = COALESCE(VALUES(state), state),
         occurred_at = GREATEST(occurred_at, VALUES(occurred_at))`,
      [
        l.devRepoId, l.ticketId, l.workItemId, l.kind, l.ref.slice(0, 255),
        l.title ? l.title.slice(0, 255) : null, l.url ? l.url.slice(0, 500) : null,
        l.authorLogin ? l.authorLogin.slice(0, 100) : null, l.state, l.source, l.occurredAt,
      ],
    );
  }

  listLinks(filter: { ticketId?: number; workItemId?: number }): Promise<DevLink[]> {
    const where = filter.ticketId ? { ticketId: filter.ticketId } : { workItemId: filter.workItemId };
    return this.links.find({ where, order: { occurredAt: 'DESC', id: 'DESC' }, take: 200 });
  }
}
