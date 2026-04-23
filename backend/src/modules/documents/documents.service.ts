import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DocumentsRepository } from './documents.repository';
import { TemplateRendererService } from './services/template-renderer.service';
import { UpsertTemplateDto } from './dto/upsert-template.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentTemplate } from './entities/document-template.entity';
import {
  CommercialDocument,
  CommercialDocumentStatus,
} from './entities/commercial-document.entity';
import { ClientsService } from '../clients/clients.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { DocumentPdfService } from './services/document-pdf.service';
import { EmailService } from '../email/email.service';
import { DocumentSignatoriesService } from '../document-signatories/document-signatories.service';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly repo: DocumentsRepository,
    private readonly renderer: TemplateRendererService,
    private readonly clients: ClientsService,
    private readonly workspace: WorkspaceService,
    private readonly pdf: DocumentPdfService,
    private readonly email: EmailService,
    private readonly signatories: DocumentSignatoriesService,
  ) {}

  /**
   * Renderiza un documento a PDF usando los datos del emisor como membrete.
   */
  async getPdfBuffer(id: number): Promise<Buffer> {
    const [doc, sigs, emisor, emisorLogoBuffer] = await Promise.all([
      this.findDocumentOrFail(id),
      this.signatories.list(id),
      this.workspace.get().catch(() => null),
      this.workspace.getLogoBuffer().catch(() => null),
    ]);
    return this.pdf.render({ doc, emisor, emisorLogoBuffer, signatories: sigs });
  }

  /**
   * Envía el documento por correo con el PDF adjunto + cuerpo HTML bonito.
   * Si el documento está en DRAFT, lo marca como SENT tras enviar.
   */
  async sendByEmail(
    id: number,
    params: {
      to: string;
      cc?: string;
      subject?: string;
      message?: string;
    },
  ): Promise<{ messageId: string }> {
    const doc = await this.findDocumentOrFail(id);
    const [emisor, client, emisorLogoBuffer, sigs] = await Promise.all([
      this.workspace.get().catch(() => null),
      this.clients.findByIdOrFail(doc.clientId),
      this.workspace.getLogoBuffer().catch(() => null),
      this.signatories.list(id),
    ]);
    const pdfBuffer = await this.pdf.render({ doc, emisor, emisorLogoBuffer, signatories: sigs });

    const subject =
      params.subject?.trim() ||
      `${this.typeLabel(doc.type)} — ${emisor?.razonSocial ?? 'Kubo DevDocs'}`;

    const html = this.buildEmailHtml({
      doc,
      client: client.razonSocial,
      emisor,
      personalMessage: params.message,
    });

    const filename = `${doc.title.replace(/[^a-z0-9áéíóúñ\s-]/gi, '').trim().slice(0, 80) || `documento-${doc.id}`}.pdf`;

    const result = await this.email.send({
      to: params.to,
      cc: params.cc,
      subject,
      html,
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
      replyTo: emisor?.email ?? undefined,
    });

    // Si el SMTP aceptó pero marcó el destinatario como rechazado, avisamos.
    if (result.rejected.length > 0) {
      this.logger.warn(
        `Correo del doc ${doc.id} fue RECHAZADO por SMTP para: ${result.rejected.join(', ')}`,
      );
    }

    // Si estaba en DRAFT lo pasamos a SENT (solo si hubo al menos un destinatario aceptado)
    if (doc.status === 'DRAFT' && result.accepted.length > 0) {
      await this.repo.updateDocument(id, { status: 'SENT' });
    }

    return { messageId: result.messageId };
  }

  private typeLabel(type: string): string {
    const labels: Record<string, string> = {
      CONTRACT: 'Contrato',
      QUOTE: 'Cotización',
      NDA: 'Acuerdo de Confidencialidad',
      SOW: 'Statement of Work',
      TDR: 'Términos de Referencia',
      ADDENDUM: 'Addendum',
      OTHER: 'Documento',
    };
    return labels[type] ?? 'Documento';
  }

  private buildEmailHtml(args: {
    doc: CommercialDocument;
    client: string;
    emisor: { razonSocial: string; email: string | null; phone: string | null; website: string | null; logoUrl: string | null; address: string | null; ruc: string | null } | null;
    personalMessage?: string;
  }): string {
    const { doc, client, emisor, personalMessage } = args;
    const brand = emisor?.razonSocial ?? 'Kubo DevDocs';
    const typeLabel = this.typeLabel(doc.type);
    const logoHtml = emisor?.logoUrl
      ? `<img src="${emisor.logoUrl}" alt="${this.escape(brand)}" style="max-height:42px;max-width:180px" />`
      : `<span style="font-size:18px;font-weight:700;color:#ffffff">${this.escape(brand)}</span>`;

    const msgBlock = personalMessage?.trim()
      ? `<div style="padding:16px 20px;background:#F8FAFC;border-left:3px solid #4F46E5;border-radius:6px;margin:20px 0;white-space:pre-wrap;font-size:14px;line-height:1.6;color:#334155">${this.escape(personalMessage)}</div>`
      : '';

    const contactLines: string[] = [];
    if (emisor?.email) contactLines.push(emisor.email);
    if (emisor?.phone) contactLines.push(emisor.phone);
    if (emisor?.website) contactLines.push(emisor.website);

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${this.escape(doc.title)}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;color:#0F172A">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,.08)">
          <!-- Banda superior -->
          <tr>
            <td style="background:linear-gradient(135deg,#4F46E5 0%,#6366F1 100%);padding:24px 28px">
              ${logoHtml}
            </td>
          </tr>
          <!-- Contenido -->
          <tr>
            <td style="padding:28px">
              <p style="margin:0 0 6px 0;font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:.06em;font-weight:600">${this.escape(typeLabel)}</p>
              <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:#0F172A">${this.escape(doc.title)}</h1>
              <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;color:#334155">
                Estimados de <strong>${this.escape(client)}</strong>,
              </p>
              <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#334155">
                Adjuntamos el documento <strong>"${this.escape(doc.title)}"</strong> (${this.escape(typeLabel)}) en formato PDF.
              </p>
              ${msgBlock}
              <p style="margin:0 0 4px 0;font-size:15px;line-height:1.6;color:#334155">
                Cualquier consulta, pueden responder este mismo correo.
              </p>
              <p style="margin:16px 0 0 0;font-size:15px;line-height:1.6;color:#334155">
                Saludos cordiales,<br />
                <strong>${this.escape(brand)}</strong>
              </p>
              <!-- Caja de adjunto -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;width:100%">
                <tr>
                  <td style="padding:14px 16px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="width:38px;vertical-align:top">
                          <div style="width:32px;height:32px;border-radius:6px;background:#EEF2FF;display:inline-block;text-align:center;line-height:32px;font-size:16px">📄</div>
                        </td>
                        <td style="vertical-align:top">
                          <p style="margin:0;font-size:14px;font-weight:600;color:#0F172A">${this.escape(doc.title)}.pdf</p>
                          <p style="margin:2px 0 0 0;font-size:12px;color:#64748B">Documento adjunto · PDF</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0">
              <p style="margin:0;font-size:12px;color:#64748B;line-height:1.6">
                <strong style="color:#0F172A">${this.escape(brand)}</strong>${emisor?.ruc ? ` · RUC ${this.escape(emisor.ruc)}` : ''}${emisor?.address ? `<br />${this.escape(emisor.address)}` : ''}${contactLines.length ? `<br />${contactLines.map((c) => this.escape(c)).join(' · ')}` : ''}
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:12px 0 0 0;font-size:11px;color:#94A3B8">
          Este correo fue enviado automáticamente desde Kubo DevDocs.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private escape(s: string | null | undefined): string {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ===================== TEMPLATES =====================

  listTemplates(onlyActive = true): Promise<DocumentTemplate[]> {
    return this.repo.listTemplates(onlyActive);
  }

  async findTemplateOrFail(id: number): Promise<DocumentTemplate> {
    const t = await this.repo.findTemplate(id);
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Plantilla no encontrada' });
    return t;
  }

  createTemplate(userId: number, dto: UpsertTemplateDto): Promise<DocumentTemplate> {
    return this.repo.createTemplate({
      name: dto.name,
      type: dto.type,
      description: dto.description ?? null,
      contentMarkdown: dto.contentMarkdown,
      variablesSchema: dto.variablesSchema,
      isActive: dto.isActive === false ? 0 : 1,
      createdBy: userId,
    });
  }

  async updateTemplate(id: number, dto: UpsertTemplateDto): Promise<DocumentTemplate> {
    await this.findTemplateOrFail(id);
    const updated = await this.repo.updateTemplate(id, {
      name: dto.name,
      type: dto.type,
      description: dto.description ?? null,
      contentMarkdown: dto.contentMarkdown,
      variablesSchema: dto.variablesSchema,
      isActive: dto.isActive === false ? 0 : 1,
    });
    return updated!;
  }

  async removeTemplate(id: number): Promise<void> {
    await this.findTemplateOrFail(id);
    await this.repo.removeTemplate(id);
  }

  // ===================== DOCUMENTS =====================

  listDocuments(params: {
    clientId?: number;
    status?: CommercialDocumentStatus;
  }): Promise<CommercialDocument[]> {
    return this.repo.listDocuments(params);
  }

  async findDocumentOrFail(id: number): Promise<CommercialDocument> {
    const d = await this.repo.findDocument(id);
    if (!d) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
    return d;
  }

  async createDocument(userId: number, dto: CreateDocumentDto): Promise<CommercialDocument> {
    this.logger.log(`createDocument DTO: ${JSON.stringify(dto)}`);

    const client = await this.clients.findByIdOrFail(dto.clientId);
    const template = await this.findTemplateOrFail(dto.templateId);

    // Auto-rellenar variables de source='client' / 'auto' / 'workspace'
    const manual = dto.variables ?? {};
    const resolvedVars = await this.buildAutoVariables(client, manual);
    this.logger.log(`createDocument resolvedVars: ${JSON.stringify(resolvedVars)}`);

    // Validar variables requeridas (considerando 0 como válido)
    const isEmpty = (v: unknown): boolean =>
      v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

    const missing = template.variablesSchema.variables
      .filter((v) => v.required)
      .filter((v) => isEmpty(resolvedVars[v.key]))
      .map((v) => v.label);

    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Faltan variables requeridas: ${missing.join(', ')}`,
      });
    }

    const rendered = this.renderer.render(template.contentMarkdown, resolvedVars);

    return this.repo.createDocument({
      clientId: dto.clientId,
      templateId: dto.templateId,
      meetingId: dto.meetingId ?? null,
      projectId: dto.projectId ?? null,
      title: dto.title,
      type: template.type,
      status: 'DRAFT',
      contentMarkdown: rendered,
      variablesValues: resolvedVars,
      version: 1,
      createdBy: userId,
    });
  }

  async updateDocument(id: number, dto: UpdateDocumentDto): Promise<CommercialDocument> {
    const doc = await this.findDocumentOrFail(id);
    if (doc.status === 'SIGNED') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'No se puede editar un documento firmado',
      });
    }

    const patch: Partial<CommercialDocument> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.status !== undefined) patch.status = dto.status;

    // Si cambian variables, re-renderizar desde la plantilla original
    if (dto.variables !== undefined && doc.templateId) {
      const template = await this.findTemplateOrFail(doc.templateId);
      const client = await this.clients.findByIdOrFail(doc.clientId);
      const resolvedVars = await this.buildAutoVariables(client, dto.variables);
      patch.variablesValues = resolvedVars;
      patch.contentMarkdown = this.renderer.render(template.contentMarkdown, resolvedVars);
      patch.version = doc.version + 1;
    } else if (dto.contentMarkdown !== undefined) {
      // Edición manual del markdown ya renderizado
      patch.contentMarkdown = dto.contentMarkdown;
      patch.version = doc.version + 1;
    }

    const updated = await this.repo.updateDocument(id, patch);
    return updated!;
  }

  async removeDocument(id: number): Promise<void> {
    const doc = await this.findDocumentOrFail(id);
    if (doc.status === 'SIGNED') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'No se puede eliminar un documento firmado',
      });
    }
    await this.repo.removeDocument(id);
  }

  /**
   * Crea un documento sin template — para casos donde el markdown se genera dinámicamente
   * (ej. informes IA desde Jira). Aplica auto-rellenado de {{emisor_*}} sobre el markdown provisto.
   */
  async createDocumentRaw(
    userId: number,
    input: {
      clientId: number;
      projectId?: number;
      meetingId?: number;
      title: string;
      type: CommercialDocument['type'];
      contentMarkdown: string;
      variablesValues?: Record<string, string | number | null>;
    },
  ): Promise<CommercialDocument> {
    const client = await this.clients.findByIdOrFail(input.clientId);
    const resolvedVars = await this.buildAutoVariables(client, input.variablesValues ?? {});
    const rendered = this.renderer.render(input.contentMarkdown, resolvedVars);

    return this.repo.createDocument({
      clientId: input.clientId,
      templateId: null,
      meetingId: input.meetingId ?? null,
      projectId: input.projectId ?? null,
      title: input.title,
      type: input.type,
      status: 'DRAFT',
      contentMarkdown: rendered,
      variablesValues: resolvedVars,
      version: 1,
      createdBy: userId,
    });
  }

  /**
   * Inyecta valores automáticos (datos del cliente, del emisor y fecha)
   * si no vinieron sobreescritos en el dto.variables.
   */
  private async buildAutoVariables(
    client: { razonSocial: string; ruc: string | null; legalRepName: string | null; legalRepDoc: string | null; address: string | null; phone: string | null; contactEmail: string | null },
    manual: Record<string, string | number | null>,
  ): Promise<Record<string, string | number | null>> {
    const today = new Date().toLocaleDateString('es-PE', { dateStyle: 'long' });

    // Datos del emisor (membrete) — si no está configurado, valores vacíos
    const emisor = await this.workspace.get().catch(() => null);

    const autoValues: Record<string, string | number | null> = {
      // Cliente
      cliente_razon_social: client.razonSocial,
      cliente_ruc: client.ruc ?? '',
      cliente_representante: client.legalRepName ?? '',
      cliente_dni: client.legalRepDoc ?? '',
      cliente_direccion: client.address ?? '',
      cliente_telefono: client.phone ?? '',
      cliente_email: client.contactEmail ?? '',
      // Emisor (membrete)
      emisor_razon_social: emisor?.razonSocial ?? '',
      emisor_ruc: emisor?.ruc ?? '',
      emisor_representante: emisor?.legalRepName ?? '',
      emisor_dni_representante: emisor?.legalRepDoc ?? '',
      emisor_direccion: emisor?.address ?? '',
      emisor_telefono: emisor?.phone ?? '',
      emisor_email: emisor?.email ?? '',
      emisor_website: emisor?.website ?? '',
      emisor_logo_url: emisor?.logoUrl ?? '',
      // Fecha
      fecha_emision: today,
      fecha_firma: today,
    };
    return { ...autoValues, ...manual };
  }
}
