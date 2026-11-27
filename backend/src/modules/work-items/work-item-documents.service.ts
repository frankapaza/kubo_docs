import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';
import { Repository } from 'typeorm';

import { MarkdownPdf, PDF_COLORS } from '../../common/pdf/markdown-pdf.helper';
import { IStorageService, STORAGE_SERVICE } from '../audio/interfaces/storage.interface';
import { sanitizeFilename, toHeaderFilename } from '../ticket-messages/ticket-attachments.service';
import {
  DOCX_MIME,
  docxText,
  DOC_EXTENSIONS,
  WORK_ITEM_DOC_KINDS,
  WORK_ITEM_DOC_KIND_LABELS,
  WorkItemDocKind,
  WorkItemDocSource,
  WorkItemDocStatus,
  assertDocAcceptable,
} from './domain/work-item-docs';
import { WorkItemAttachment } from './entities/work-item-attachment.entity';
import { WorkItemEventsService } from './work-item-events.service';
import { WorkItemsService } from './work-items.service';

/** Lo que sale de este servicio: la fila sin la clave de almacenamiento. */
export interface WorkItemDocView {
  id: number;
  workItemId: number;
  kind: WorkItemDocKind;
  kindLabel: string;
  status: WorkItemDocStatus;
  source: WorkItemDocSource;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: number | null;
  uploadedByClientUserId: number | null;
  approvedByUserId: number | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface WorkItemDocUpload {
  workItemId: number;
  /** `null` cuando lo sube el sistema (el acta firmada) o el cliente. */
  actorUserId: number | null;
  /** Usuario del portal, cuando `source` es `CLIENTE`. */
  actorClientUserId?: number | null;
  kind: WorkItemDocKind;
  buffer: Buffer;
  filename: string;
  status?: WorkItemDocStatus;
  source?: WorkItemDocSource;
}

const DOC_NOT_FOUND = { code: 'NOT_FOUND', message: 'Ese documento no existe en este requerimiento.' } as const;
const NO_SE_PUDO_GUARDAR = { code: 'STORAGE_ERROR', message: 'No se pudo guardar el documento. Inténtalo de nuevo.' } as const;

/**
 * Documentos de un requerimiento: Especificación, Manual de usuario, Acta de
 * conformidad y otros. Mismo criterio que los adjuntos de tickets: el tipo se
 * decide por los bytes, la clave la genera el servidor, el disco se escribe
 * antes que la fila y, si la fila falla, se borra el archivo.
 */
@Injectable()
export class WorkItemDocumentsService {
  private readonly logger = new Logger(WorkItemDocumentsService.name);
  private readonly md = new MarkdownPdf();

  constructor(
    @InjectRepository(WorkItemAttachment) private readonly repo: Repository<WorkItemAttachment>,
    private readonly items: WorkItemsService,
    private readonly events: WorkItemEventsService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  async list(workItemId: number): Promise<WorkItemDocView[]> {
    const rows = await this.repo.find({ where: { workItemId }, order: { createdAt: 'ASC', id: 'ASC' } });
    return rows.map(toView);
  }

  /** Solo los de un origen (p. ej. lo que subió el cliente, para el portal). */
  async listBySource(workItemId: number, source: WorkItemDocSource): Promise<WorkItemDocView[]> {
    const rows = await this.repo.find({ where: { workItemId, source }, order: { createdAt: 'ASC', id: 'ASC' } });
    return rows.map(toView);
  }

  countBySource(workItemId: number, source: WorkItemDocSource): Promise<number> {
    return this.repo.count({ where: { workItemId, source } });
  }

  async upload(input: WorkItemDocUpload): Promise<WorkItemDocView> {
    if (!WORK_ITEM_DOC_KINDS.includes(input.kind)) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: `Tipo de documento desconocido. Usa uno de: ${WORK_ITEM_DOC_KINDS.join(', ')}.`,
      });
    }
    const item = await this.items.findByIdOrFail(input.workItemId);
    const mimeType = assertDocAcceptable(input.buffer);
    const filename = sanitizeFilename(input.filename).slice(0, 255);
    const status = input.status ?? 'VIGENTE';
    const source = input.source ?? 'WEB';

    const storageKey = `work-items/${numeric(item.id)}/${randomUUID()}.${DOC_EXTENSIONS[mimeType]}`;
    try {
      await this.storage.save(input.buffer, storageKey, mimeType);
    } catch (cause) {
      this.logger.error(`No se pudo escribir «${storageKey}».`, cause as Error);
      throw new InternalServerErrorException(NO_SE_PUDO_GUARDAR);
    }

    let row: WorkItemAttachment;
    try {
      row = await this.repo.save(
        this.repo.create({
          workItemId: Number(item.id),
          kind: input.kind,
          status,
          source,
          filename,
          storageKey,
          mimeType,
          sizeBytes: input.buffer.length,
          uploadedByUserId: input.actorUserId,
          uploadedByClientUserId: input.actorClientUserId ?? null,
          approvedByUserId: null,
          approvedAt: null,
        }),
      );
    } catch (cause) {
      await this.storage.remove(storageKey).catch((e) =>
        this.logger.error(`Quedó un archivo huérfano: «${storageKey}».`, e as Error),
      );
      this.logger.error('No se pudo guardar la fila del documento.', cause as Error);
      throw new InternalServerErrorException(NO_SE_PUDO_GUARDAR);
    }

    const label = WORK_ITEM_DOC_KIND_LABELS[input.kind];
    await this.events.record({
      workItemId: Number(item.id),
      type: 'COMMENT',
      actorUserId: input.actorUserId,
      actorClientUserId: input.actorClientUserId ?? null,
      reason:
        source === 'CLIENTE'
          ? `El cliente adjuntó «${filename}».`
          : status === 'BORRADOR'
            ? `Adjuntó «${filename}» (${label}, borrador para revisar).`
            : `Adjuntó «${filename}» (${label}).`,
      payload: {
        documentId: Number(row.id),
        kind: input.kind,
        via: source === 'CLAUDE' ? 'claude' : source === 'CLIENTE' ? 'portal' : 'web',
      },
    });
    return toView(row);
  }

  /** Para servir la descarga: flujo, tipo y los dos nombres (ver `serveAttachment`). */
  async download(workItemId: number, docId: number) {
    const row = await this.findOrFail(workItemId, docId);
    const stream = this.storage.createReadStream(row.storageKey);
    stream.on('error', (cause: Error) => this.logger.error(`No se pudo leer «${row.storageKey}».`, cause));
    return {
      stream,
      filename: row.filename,
      headerFilename: toHeaderFilename(row.filename),
      mimeType: row.mimeType,
      size: row.sizeBytes,
    };
  }

  /** El documento entero en memoria, para el conector de Claude. */
  async readBuffer(workItemId: number, docId: number): Promise<{ doc: WorkItemDocView; buffer: Buffer }> {
    const d = await this.download(workItemId, docId);
    const chunks: Buffer[] = [];
    for await (const c of d.stream as AsyncIterable<Buffer | string>) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const row = await this.findOrFail(workItemId, docId);
    return { doc: toView(row), buffer: Buffer.concat(chunks) };
  }

  /** El texto de un Word; `null` para un PDF o una imagen, que aquí no se leen. */
  async readText(workItemId: number, docId: number): Promise<string | null> {
    const row = await this.findOrFail(workItemId, docId);
    if (row.mimeType !== DOCX_MIME) return null;
    const { buffer } = await this.readBuffer(workItemId, docId);
    return docxText(buffer);
  }

  async approve(workItemId: number, docId: number, actorUserId: number): Promise<WorkItemDocView> {
    const row = await this.findOrFail(workItemId, docId);
    if (row.status === 'VIGENTE') return toView(row);
    const saved = await this.repo.save({ ...row, status: 'VIGENTE', approvedByUserId: actorUserId, approvedAt: new Date() });
    await this.events.record({
      workItemId,
      type: 'COMMENT',
      actorUserId,
      reason: `Aprobó «${row.filename}» (${WORK_ITEM_DOC_KIND_LABELS[row.kind]}).`,
      payload: { documentId: Number(row.id), kind: row.kind },
    });
    return toView(saved as WorkItemAttachment);
  }

  /**
   * Las claves de los archivos de un requerimiento, para borrarlos cuando se
   * borra el requerimiento: las filas se van solas (ON DELETE CASCADE), los
   * archivos no. Se leen ANTES de borrar el requerimiento.
   */
  async storageKeysOf(workItemId: number): Promise<string[]> {
    const rows = await this.repo.find({ where: { workItemId } });
    return rows.map((r) => r.storageKey);
  }

  /** Borra los archivos; uno que falle se registra y no detiene a los demás. */
  async discardFiles(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.storage.remove(key).catch((e) => this.logger.error(`No se pudo borrar el archivo «${key}».`, e as Error));
    }
  }

  async remove(workItemId: number, docId: number, actorUserId: number): Promise<void> {
    const row = await this.findOrFail(workItemId, docId);
    await this.repo.delete({ id: row.id });
    await this.storage.remove(row.storageKey).catch((e) =>
      this.logger.error(`No se pudo borrar el archivo «${row.storageKey}».`, e as Error),
    );
    await this.events.record({
      workItemId,
      type: 'COMMENT',
      actorUserId,
      reason: `Quitó «${row.filename}» (${WORK_ITEM_DOC_KIND_LABELS[row.kind]}).`,
      payload: { documentId: Number(row.id), kind: row.kind },
    });
  }

  /**
   * Un Markdown convertido a PDF con el estilo de los demás documentos: el
   * manual que redacta Claude, o la Especificación y el brief que redacta la IA.
   */
  renderManualPdf(title: string, markdown: string, subtitle = 'Manual de usuario'): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 60, left: 56, right: 56 },
        info: { Title: title, Author: 'Kubo DevDocs', Subject: subtitle },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.font('Helvetica-Bold').fontSize(16).fillColor(PDF_COLORS.ink).text(title);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text(`${subtitle} · Kubo DevDocs`);
      doc.moveDown(1);
      this.md.drawBody(doc, markdown);
      doc.end();
    });
  }

  private async findOrFail(workItemId: number, docId: number): Promise<WorkItemAttachment> {
    const row = await this.repo.findOneBy({ id: docId, workItemId });
    if (!row) throw new NotFoundException(DOC_NOT_FOUND);
    return row;
  }
}

function numeric(v: number | string): string {
  const s = String(v);
  if (!/^[0-9]+$/.test(s)) throw new InternalServerErrorException(NO_SE_PUDO_GUARDAR);
  return s;
}

function toView(r: WorkItemAttachment): WorkItemDocView {
  return {
    id: Number(r.id),
    workItemId: Number(r.workItemId),
    kind: r.kind,
    kindLabel: WORK_ITEM_DOC_KIND_LABELS[r.kind] ?? r.kind,
    status: r.status,
    source: r.source,
    filename: r.filename,
    mimeType: r.mimeType,
    sizeBytes: Number(r.sizeBytes),
    uploadedByUserId: r.uploadedByUserId == null ? null : Number(r.uploadedByUserId),
    uploadedByClientUserId: r.uploadedByClientUserId == null ? null : Number(r.uploadedByClientUserId),
    approvedByUserId: r.approvedByUserId == null ? null : Number(r.approvedByUserId),
    approvedAt: r.approvedAt ? new Date(r.approvedAt).toISOString() : null,
    createdAt: new Date(r.createdAt).toISOString(),
  };
}
