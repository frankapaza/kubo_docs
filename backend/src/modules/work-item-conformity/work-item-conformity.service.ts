import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Subscription } from 'rxjs';
import { DataSource, Repository } from 'typeorm';

import { ClientsService } from '../clients/clients.service';
import { DocumentSignatoriesService } from '../document-signatories/document-signatories.service';
import { DocumentsService } from '../documents/documents.service';
import { CommercialDocument } from '../documents/entities/commercial-document.entity';
import { buildConformityMarkdown } from '../work-items/domain/conformity-act';
import { WorkItem } from '../work-items/entities/work-item.entity';
import { WorkItemBoardService } from '../work-items/work-item-board.service';
import { WorkItemDocumentsService } from '../work-items/work-item-documents.service';
import { WorkItemEventsService } from '../work-items/work-item-events.service';

export interface ConformitySigner {
  signerName: string;
  signerEmail: string;
  signerDocumentNumber?: string | null;
  signerRole?: string | null;
  observaciones?: string | null;
}

export interface ConformityView {
  documentId: number;
  title: string;
  status: string;
  createdAt: string;
  signatories: Array<{
    id: number;
    fullName: string;
    email: string | null;
    role: string | null;
    status: string;
    signedAt: string | null;
    tokenExpiresAt: string | null;
  }>;
  /** Solo al crear o reenviar: el correo no salió y hay que reenviar. */
  emailError?: string;
}

const NO_ACTA = { code: 'NOT_FOUND', message: 'Este requerimiento no tiene acta de conformidad.' } as const;
const CERRADOS = ['CERRADO', 'CANCELADO', 'RECHAZADO'];

/**
 * Acta de conformidad de un requerimiento: se genera en PRUEBAS, el cliente la
 * firma por enlace (firmantes de documentos) y, cuando firman todos, el PDF
 * firmado queda en los documentos del requerimiento y este se cierra.
 */
@Injectable()
export class WorkItemConformityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkItemConformityService.name);
  private sub?: Subscription;

  constructor(
    @InjectRepository(WorkItem) private readonly items: Repository<WorkItem>,
    @InjectRepository(CommercialDocument) private readonly docOrm: Repository<CommercialDocument>,
    @InjectDataSource() private readonly data: DataSource,
    private readonly clients: ClientsService,
    private readonly docs: WorkItemDocumentsService,
    private readonly events: WorkItemEventsService,
    private readonly board: WorkItemBoardService,
    private readonly documents: DocumentsService,
    private readonly signatories: DocumentSignatoriesService,
  ) {}

  onModuleInit(): void {
    this.sub = this.signatories.signed$.subscribe(({ documentId }) => {
      this.handleSigned(documentId).catch((e) =>
        this.logger.error(`No se pudo cerrar el requerimiento del acta ${documentId} tras la firma.`, e as Error),
      );
    });
  }

  onModuleDestroy(): void {
    this.sub?.unsubscribe();
  }

  async get(workItemId: number): Promise<ConformityView | null> {
    const item = await this.itemOrFail(workItemId);
    if (item.conformityDocumentId == null) return null;
    const doc = await this.docOrm.findOneBy({ id: Number(item.conformityDocumentId) });
    if (!doc) return null;
    return this.view(doc);
  }

  async create(workItemId: number, actorUserId: number, s: ConformitySigner): Promise<ConformityView> {
    const item = await this.itemOrFail(workItemId);
    if (item.status !== 'PRUEBAS') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `El acta se genera con el requerimiento en Pruebas; este está en ${item.status}.`,
      });
    }
    if (item.conformityDocumentId != null) {
      const prev = await this.docOrm.findOneBy({ id: Number(item.conformityDocumentId) });
      if (prev && prev.status !== 'CANCELLED') {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Ya hay un acta enviada para este requerimiento: reenvía el enlace o anúlala antes de generar otra.',
        });
      }
    }

    const [client, systemRows, links, docs] = await Promise.all([
      this.clients.findByIdOrFail(Number(item.clientId)),
      item.clientSystemId != null
        ? this.data.query(
            'SELECT s.name AS name FROM client_systems cs JOIN systems s ON s.id = cs.system_id WHERE cs.id = ?',
            [item.clientSystemId],
          )
        : Promise.resolve([]),
      this.data.query(
        'SELECT kind, ref, title, url FROM dev_links WHERE work_item_id = ? ORDER BY occurred_at',
        [item.id],
      ),
      this.docs.list(Number(item.id)),
    ]);

    const code = item.code ?? `RQ-${item.id}`;
    const markdown = buildConformityMarkdown({
      codigo: code,
      titulo: item.title,
      cliente: client.razonSocial,
      sistema: (systemRows as Array<{ name: string }>)[0]?.name ?? null,
      fechaComprometida: item.dueDate ?? null,
      fechaEntrega: new Date(),
      criterios: item.acceptanceCriteria ?? [],
      evidencia: (links as Array<{ kind: string; ref: string; title: string | null; url: string | null }>)
        // Las ramas no son evidencia de entrega; los commits y PR sí.
        .filter((l) => l.kind !== 'BRANCH')
        .map((l) => ({ tipo: l.kind, ref: l.kind === 'COMMIT' ? l.ref.slice(0, 10) : l.ref, titulo: l.title, url: l.url })),
      documentos: docs.filter((d) => d.status === 'VIGENTE' && d.kind !== 'ACTA_CONFORMIDAD').map((d) => d.filename),
      firmante: { nombre: s.signerName.trim(), cargo: s.signerRole?.trim() || null },
      observaciones: s.observaciones ?? null,
    });

    const doc = await this.documents.createDocumentRaw(actorUserId, {
      clientId: Number(item.clientId),
      title: `Acta de conformidad · ${code} · ${item.title}`.slice(0, 250),
      type: 'ACTA_CONFORMIDAD',
      contentMarkdown: markdown,
    });
    await this.items.update({ id: Number(item.id) }, { conformityDocumentId: Number(doc.id) });

    const sig = await this.signatories.create(Number(doc.id), {
      kind: 'EXTERNAL',
      fullName: s.signerName.trim(),
      email: s.signerEmail.trim(),
      documentNumber: s.signerDocumentNumber?.trim() || undefined,
      role: s.signerRole?.trim() || undefined,
    });
    await this.docOrm.update(Number(doc.id), { status: 'SENT' });

    let emailError: string | undefined;
    try {
      await this.signatories.requestSignature(Number(sig.id));
    } catch (e) {
      this.logger.error(`No se pudo enviar el acta ${doc.id} a firma.`, e as Error);
      emailError = 'El acta se generó, pero no se pudo enviar el correo de firma. Revisa el correo del firmante y pulsa «Reenviar enlace».';
    }

    await this.events.record({
      workItemId: Number(item.id),
      type: 'COMMENT',
      actorUserId,
      reason: `Envió el acta de conformidad a ${s.signerName.trim()} (${s.signerEmail.trim()}) para firma.`,
      payload: { conformityDocumentId: Number(doc.id) },
    });

    const fresh = (await this.docOrm.findOneBy({ id: Number(doc.id) })) ?? (doc as CommercialDocument);
    return { ...(await this.view(fresh)), ...(emailError ? { emailError } : {}) };
  }

  /** Vuelve a mandar el enlace a quien aún no firmó (nuevo enlace, 7 días). */
  async resend(workItemId: number): Promise<ConformityView> {
    const doc = await this.actaOrFail(workItemId);
    let emailError: string | undefined;
    for (const s of await this.signatories.list(Number(doc.id))) {
      if (s.conformityStatus === 'SIGNED' || !s.email) continue;
      try {
        await this.signatories.requestSignature(Number(s.id));
      } catch (e) {
        this.logger.error(`No se pudo reenviar el acta ${doc.id} a ${s.id}.`, e as Error);
        emailError = 'No se pudo enviar el correo de firma. Revisa la configuración de correo e inténtalo de nuevo.';
      }
    }
    return { ...(await this.view(doc)), ...(emailError ? { emailError } : {}) };
  }

  /** Anula el acta (firmante equivocado, cambios de alcance): permite generar otra. */
  async cancel(workItemId: number, actorUserId: number): Promise<void> {
    const doc = await this.actaOrFail(workItemId);
    if (doc.status === 'SIGNED') {
      throw new ConflictException({ code: 'CONFLICT', message: 'El acta ya fue firmada: no se puede anular.' });
    }
    await this.docOrm.update(Number(doc.id), { status: 'CANCELLED' });
    await this.items.update({ id: workItemId }, { conformityDocumentId: null });
    await this.events.record({
      workItemId,
      type: 'COMMENT',
      actorUserId,
      reason: 'Anuló el acta de conformidad enviada.',
      payload: { conformityDocumentId: Number(doc.id) },
    });
  }

  /**
   * Tras una firma: si ya firmaron todos, adjunta el PDF firmado, marca el acta
   * como firmada y cierra el requerimiento. Idempotente: un aviso repetido no
   * duplica el documento.
   */
  async handleSigned(documentId: number): Promise<void> {
    const item = await this.items.findOneBy({ conformityDocumentId: documentId });
    if (!item) return;
    const sigs = await this.signatories.list(documentId);
    if (sigs.length === 0 || sigs.some((s) => s.conformityStatus !== 'SIGNED')) return;
    const doc = await this.docOrm.findOneBy({ id: documentId });
    if (!doc || doc.status === 'SIGNED') return;

    const code = item.code ?? `RQ-${item.id}`;
    const pdf = await this.documents.getPdfBuffer(documentId);
    await this.docs.upload({
      workItemId: Number(item.id),
      actorUserId: null,
      kind: 'ACTA_CONFORMIDAD',
      status: 'VIGENTE',
      source: 'WEB',
      buffer: pdf,
      filename: `${code} - Acta de conformidad firmada.pdf`,
    });
    await this.docOrm.update(documentId, { status: 'SIGNED' });

    const firmantes = sigs.map((s) => s.fullName).join(', ');
    if (!CERRADOS.includes(item.status)) {
      const actor = Number(doc.createdBy ?? item.createdBy ?? item.assigneeUserId ?? 0);
      await this.board.move({
        workItemId: Number(item.id),
        actorUserId: actor,
        toStatus: 'CERRADO',
        toIndex: 0,
        reason: `Acta de conformidad firmada por ${firmantes}.`,
      });
    }
    await this.events.record({
      workItemId: Number(item.id),
      type: 'COMMENT',
      actorUserId: null,
      reason: `${firmantes} firmó el acta de conformidad. El PDF firmado quedó en Documentos.`,
      payload: { conformityDocumentId: documentId },
    });
  }

  private async itemOrFail(id: number): Promise<WorkItem> {
    const item = await this.items.findOneBy({ id });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado.' });
    return item;
  }

  private async actaOrFail(workItemId: number): Promise<CommercialDocument> {
    const item = await this.itemOrFail(workItemId);
    if (item.conformityDocumentId == null) throw new NotFoundException(NO_ACTA);
    const doc = await this.docOrm.findOneBy({ id: Number(item.conformityDocumentId) });
    if (!doc) throw new NotFoundException(NO_ACTA);
    return doc;
  }

  private async view(doc: CommercialDocument): Promise<ConformityView> {
    const sigs = await this.signatories.list(Number(doc.id));
    return {
      documentId: Number(doc.id),
      title: doc.title,
      status: doc.status,
      createdAt: new Date(doc.createdAt).toISOString(),
      signatories: sigs.map((s) => ({
        id: Number(s.id),
        fullName: s.fullName,
        email: s.email,
        role: s.role,
        status: s.conformityStatus,
        signedAt: s.signedAt ? new Date(s.signedAt).toISOString() : null,
        tokenExpiresAt: s.tokenExpiresAt ? new Date(s.tokenExpiresAt).toISOString() : null,
      })),
    };
  }
}
