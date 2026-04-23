import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceSetting } from './entities/workspace-setting.entity';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace.dto';
import { decryptSecret, encryptSecret } from '../../common/crypto/aes-gcm.util';

/** Config SMTP resuelta (con el password descifrado en memoria) */
export interface ResolvedSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/**
 * Singleton: siempre trabajamos con la fila id=1.
 */
@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
  constructor(
    @InjectRepository(WorkspaceSetting)
    private readonly repo: Repository<WorkspaceSetting>,
  ) {}

  async get(): Promise<WorkspaceSetting> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message:
          'Falta inicializar la configuración del emisor. Ejecuta add_workspace_settings.sql',
      });
    }
    return row;
  }

  async update(dto: UpdateWorkspaceSettingsDto): Promise<WorkspaceSetting> {
    const current = await this.get();
    const patch: Partial<WorkspaceSetting> = {};

    // Mapeo 1:1 de campos simples, convirtiendo '' → null
    const simpleKeys: (keyof UpdateWorkspaceSettingsDto)[] = [
      'razonSocial',
      'ruc',
      'legalRepName',
      'legalRepDoc',
      'address',
      'phone',
      'email',
      'website',
      'logoUrl',
      'smtpHost',
      'smtpUser',
      'smtpFrom',
    ];
    simpleKeys.forEach((key) => {
      const value = dto[key];
      if (value !== undefined) {
        (patch as Record<string, unknown>)[key] = value === '' ? null : value;
      }
    });

    // Número (session timeout / smtp port / retention days)
    if (dto.sessionTimeoutMinutes !== undefined) {
      patch.sessionTimeoutMinutes = dto.sessionTimeoutMinutes;
    }
    if (dto.smtpPort !== undefined) {
      patch.smtpPort = dto.smtpPort;
    }
    if (dto.audioRetentionPolicy !== undefined) {
      patch.audioRetentionPolicy = dto.audioRetentionPolicy;
    }
    if (dto.audioRetentionDays !== undefined) {
      patch.audioRetentionDays = dto.audioRetentionDays;
    }

    // Boolean → tinyint
    if (dto.smtpSecure !== undefined) {
      patch.smtpSecure = dto.smtpSecure ? 1 : 0;
    }

    // Password SMTP: encriptar si viene un valor; vacío explícito → limpiar
    if (dto.smtpPass !== undefined) {
      patch.smtpPassEncrypted = dto.smtpPass === '' ? null : encryptSecret(dto.smtpPass);
    }

    await this.repo.update(current.id, patch);
    return this.get();
  }

  /**
   * Devuelve la config SMTP lista para usar (con password descifrado).
   * Retorna null si no está completa.
   */
  async getSmtpConfig(): Promise<ResolvedSmtpConfig | null> {
    const s = await this.get().catch(() => null);
    if (!s?.smtpHost || !s.smtpUser || !s.smtpPassEncrypted) return null;
    try {
      const pass = decryptSecret(s.smtpPassEncrypted);
      return {
        host: s.smtpHost,
        port: s.smtpPort ?? 587,
        secure: s.smtpSecure === 1,
        user: s.smtpUser,
        pass,
        from: s.smtpFrom ?? s.smtpUser,
      };
    } catch (e) {
      this.logger.warn(`No se pudo descifrar SMTP pass: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Descarga el logo desde la URL configurada como Buffer (para PDFKit).
   * Solo acepta PNG/JPEG, máximo 2MB. Devuelve null si no hay logo o falla la descarga.
   */
  async getLogoBuffer(): Promise<Buffer | null> {
    const settings = await this.get().catch(() => null);
    if (!settings?.logoUrl) return null;
    try {
      const res = await fetch(settings.logoUrl);
      if (!res.ok) {
        this.logger.warn(`Logo fetch failed (${res.status}): ${settings.logoUrl}`);
        return null;
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (!/^image\/(png|jpeg|jpg)/i.test(contentType)) {
        this.logger.warn(`Logo no es PNG/JPEG (content-type=${contentType}): ${settings.logoUrl}`);
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > 2 * 1024 * 1024) {
        this.logger.warn(`Logo pesa más de 2MB (${arrayBuffer.byteLength} bytes)`);
        return null;
      }
      return Buffer.from(arrayBuffer);
    } catch (e) {
      this.logger.warn(`Logo fetch error: ${(e as Error).message}`);
      return null;
    }
  }
}
