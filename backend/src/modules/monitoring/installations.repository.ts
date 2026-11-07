import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LogInstallation } from './entities/log-installation.entity';
import { LogInstallationSource } from './entities/log-installation-source.entity';

@Injectable()
export class InstallationsRepository {
  constructor(
    @InjectRepository(LogInstallation) private readonly repo: Repository<LogInstallation>,
    @InjectRepository(LogInstallationSource) private readonly sources: Repository<LogInstallationSource>,
  ) {}

  findAll(): Promise<LogInstallation[]> {
    return this.repo.find({ order: { id: 'ASC' } });
  }

  findById(id: number): Promise<LogInstallation | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByClientSystemId(clientSystemId: number): Promise<LogInstallation | null> {
    return this.repo.findOne({ where: { clientSystemId } });
  }

  findByFingerprint(keyFingerprint: string): Promise<LogInstallation | null> {
    return this.repo.findOne({ where: { keyFingerprint } });
  }

  create(data: Partial<LogInstallation>): Promise<LogInstallation> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<LogInstallation>): Promise<LogInstallation | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  /** Las fuentes de las instalaciones dadas (todas si no se pasa lista). */
  listSources(installationIds?: number[]): Promise<LogInstallationSource[]> {
    if (installationIds && installationIds.length === 0) return Promise.resolve([]);
    return this.sources.find({
      where: installationIds ? { installationId: In(installationIds) } : {},
      order: { aplicativo: 'ASC', servidor: 'ASC' },
    });
  }

  /**
   * Alta o refresco del par. Un solo `INSERT ... ON DUPLICATE KEY UPDATE`: dos
   * lotes simultáneos del mismo par no pueden chocar contra `uq_log_source`.
   * `appender_version` solo se pisa si llega una (no se borra una conocida).
   */
  async upsertSource(
    installationId: number,
    aplicativo: string,
    servidor: string,
    appenderVersion: string | null,
    at: Date,
  ): Promise<void> {
    await this.sources.query(
      `INSERT INTO log_installation_sources
         (installation_id, aplicativo, servidor, appender_version, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         appender_version = COALESCE(VALUES(appender_version), appender_version),
         last_seen_at = GREATEST(last_seen_at, VALUES(last_seen_at))`,
      [installationId, aplicativo, servidor, appenderVersion, at, at],
    );
  }

  /** Último lote recibido; nunca retrocede si llega uno con hora anterior. */
  async touchInstallation(id: number, at: Date): Promise<void> {
    await this.repo.query(
      `UPDATE log_installations
          SET last_seen_at = GREATEST(COALESCE(last_seen_at, ?), ?)
        WHERE id = ?`,
      [at, at, id],
    );
  }
}
