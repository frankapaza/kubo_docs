import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { In, Repository } from 'typeorm';
import { IStorageService, STORAGE_SERVICE } from '../audio/interfaces/storage.interface';
import { User } from '../users/entities/user.entity';
import { UploadEvidenceDto } from './dto/evidence.dto';
import { MonitorEvidence, MonitorEvidenceOrigin } from './entities/monitor-evidence.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';

/** Tope del archivo: 2 MB. */
export const EVIDENCE_MAX_BYTES = 2 * 1024 * 1024;

/** Extensiones admitidas (minúsculas) y el tipo MIME con que se sirven. */
export const EVIDENCE_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

export interface EvidenceView {
  id: number;
  capturedAt: Date;
  origin: MonitorEvidenceOrigin;
  notes: string | null;
  fileName: string;
  sizeBytes: number;
  createdByName: string | null;
}

export interface EvidenceUpload {
  originalname: string;
  buffer: Buffer;
  size: number;
}

const badInput = (message: string) => new BadRequestException({ code: 'BAD_INPUT', message });
const notFound = (message: string) => new NotFoundException({ code: 'NOT_FOUND', message });

/** Evidencia (p. ej. un WinMTR) adjunta a un incidente. */
@Injectable()
export class AvailabilityEvidenceService {
  constructor(
    @InjectRepository(MonitorEvidence) private readonly evidence: Repository<MonitorEvidence>,
    @InjectRepository(MonitorIncident) private readonly incidents: Repository<MonitorIncident>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  async upload(incidentId: number, file: EvidenceUpload | undefined, dto: UploadEvidenceDto, userId: number): Promise<EvidenceView> {
    const inc = await this.incidents.findOne({ where: { id: incidentId } });
    if (!inc) throw notFound('Incidente no encontrado');
    if (!file) throw badInput('Falta el archivo (campo «file»)');

    const ext = extname(file.originalname ?? '').toLowerCase();
    const mime = EVIDENCE_MIME[ext];
    if (!mime) {
      throw new BadRequestException({
        code: 'EVIDENCIA_TIPO',
        message: `Tipo de archivo no admitido. Usa ${Object.keys(EVIDENCE_MIME).join(', ')}.`,
      });
    }
    if (file.size > EVIDENCE_MAX_BYTES) {
      throw badInput('El archivo supera el máximo de 2 MB');
    }
    const capturedAt = dto.capturedAt ? new Date(dto.capturedAt) : new Date();
    if (Number.isNaN(capturedAt.getTime())) throw badInput('Fecha de captura inválida');
    const notes = dto.notes?.trim() ? dto.notes.trim() : null;

    const key = `availability/evidence/${incidentId}/${randomUUID()}${ext}`;
    await this.storage.save(file.buffer, key, mime);

    const baseName = (file.originalname ?? '').split(/[\\/]/).pop() ?? '';
    const row = this.evidence.create({
      incidentId,
      capturedAt,
      origin: dto.origin,
      notes,
      storageKey: key,
      fileName: baseName.slice(0, 255) || `evidencia${ext}`,
      mimeType: mime,
      sizeBytes: file.size,
      createdBy: userId,
    });
    let saved: MonitorEvidence;
    try {
      saved = await this.evidence.save(row);
    } catch (e) {
      await this.storage.remove(key).catch(() => undefined);
      throw e;
    }
    const names = await this.userNames([userId]);
    return toView(saved, names);
  }

  async listForIncidents(ids: number[]): Promise<Map<number, EvidenceView[]>> {
    const out = new Map<number, EvidenceView[]>();
    if (ids.length === 0) return out;
    const rows = await this.evidence.find({ where: { incidentId: In(ids) }, order: { capturedAt: 'ASC', id: 'ASC' } });
    const names = await this.userNames(rows.map((r) => r.createdBy));
    for (const r of rows) {
      const k = Number(r.incidentId);
      const list = out.get(k) ?? [];
      list.push(toView(r, names));
      out.set(k, list);
    }
    return out;
  }

  async openFile(id: number): Promise<{ fileName: string; mimeType: string; sizeBytes: number; stream: NodeJS.ReadableStream }> {
    const row = await this.evidence.findOne({ where: { id } });
    if (!row) throw notFound('Evidencia no encontrada');
    return { fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, stream: this.storage.createReadStream(row.storageKey) };
  }

  async remove(id: number): Promise<void> {
    const row = await this.evidence.findOne({ where: { id } });
    if (!row) throw notFound('Evidencia no encontrada');
    await this.storage.remove(row.storageKey);
    await this.evidence.delete({ id });
  }

  private async userNames(ids: Array<number | null>): Promise<Map<number, string>> {
    const uniq = [...new Set(ids.filter((i): i is number => i !== null && i !== undefined).map(Number))];
    if (uniq.length === 0) return new Map();
    const users = await this.users.find({ where: { id: In(uniq) } });
    return new Map(users.map((u) => [Number(u.id), u.fullName]));
  }
}

function toView(r: MonitorEvidence, names: Map<number, string>): EvidenceView {
  return {
    id: Number(r.id),
    capturedAt: r.capturedAt,
    origin: r.origin,
    notes: r.notes,
    fileName: r.fileName,
    sizeBytes: r.sizeBytes,
    createdByName: r.createdBy !== null && r.createdBy !== undefined ? (names.get(Number(r.createdBy)) ?? null) : null,
  };
}

/** Nombre apto para `Content-Disposition`: sin separadores de ruta, comillas ni caracteres de control. */
export function safeDownloadName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  return clean || 'evidencia';
}

/** Cabecera `Content-Disposition: attachment` con `filename` ASCII y `filename*` (RFC 5987) si hay otros caracteres. */
export function contentDisposition(name: string): string {
  const safe = safeDownloadName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/[;\\]/g, '_');
  const star = encodeURIComponent(safe).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return /^[\x20-\x7e]*$/.test(safe) && !/[;\\]/.test(safe)
    ? `attachment; filename="${safe}"`
    : `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}
