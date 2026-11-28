import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertImageDimensions } from '../../actas/services/image-guard';
import { LLMService } from '../../ai/llm.service';
import { Client } from '../../clients/entities/client.entity';
import { Project } from '../entities/project.entity';
import { CATALOG, catalogEntry } from './deliverable-catalog';
import {
  DiffOp,
  DocSection,
  MAX_INSTRUCTION,
  SectionStatus,
  TemplateSection,
  aiSystemPrompt,
  aiUserPrompt,
  defaultTemplate,
  parseAiSections,
  sectionStatus,
  sectionsFromTemplate,
  validateSections,
  validateTemplate,
  wordDiff,
} from './deliverable-document';
import { AttachmentPlace, DeliverableAttachment } from './entities/deliverable-attachment.entity';
import { DeliverableTemplate } from './entities/deliverable-template.entity';
import { DeliverableView, ExpedienteService } from './expediente.service';

export type TemplateSource = 'CLIENTE' | 'KUBO_EDITADA' | 'KUBO';

export interface ResolvedTemplate {
  type: string;
  clientId: number | null;
  source: TemplateSource;
  name: string;
  sections: TemplateSection[];
}

export interface AttachmentView {
  id: number;
  sectionKey: string;
  place: AttachmentPlace;
  caption: string | null;
  position: number;
  imageMime: string;
}

export interface DocumentView {
  deliverable: DeliverableView;
  /** true si ya se guardó en la plataforma; false si las secciones salen de la plantilla. */
  saved: boolean;
  /** La versión sobre la que se edita: se devuelve al guardar para no pisar a otro. */
  baseVersion: string | null;
  template: { source: TemplateSource; name: string };
  sections: (DocSection & { status: SectionStatus })[];
  attachments: AttachmentView[];
  /** Las imágenes solo se cambian mientras no esté aprobado ni firmado. */
  attachmentsEditable: boolean;
}

export interface AiChange {
  key: string;
  num: string;
  title: string;
  before: string;
  after: string;
  diff: DiffOp[];
}

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const KEY_RE = /^[a-z0-9-]{1,40}$/;
const EDITABLE_ATTACHMENTS = ['PENDIENTE', 'BORRADOR', 'EN_REVISION'];

/**
 * El documento en línea de un entregable: plantilla con la que empieza,
 * imágenes por sección y ajuste con IA (que nunca guarda: devuelve el antes y
 * después; guardar es `ExpedienteService.saveDocument`, que crea la versión).
 * El acceso al proyecto lo comprueba el controlador.
 */
@Injectable()
export class DeliverableDocumentService {
  constructor(
    private readonly expediente: ExpedienteService,
    private readonly llm: LLMService,
    @InjectRepository(DeliverableTemplate) private readonly templates: Repository<DeliverableTemplate>,
    @InjectRepository(DeliverableAttachment) private readonly attachments: Repository<DeliverableAttachment>,
    @InjectRepository(Client) private readonly clients: Repository<Client>,
  ) {}

  // ------------------------------------------------------------ plantillas

  /** La del cliente si existe; si no, la de Kubo editada; si no, la del código. */
  async resolveTemplate(type: string, clientId: number | null): Promise<ResolvedTemplate> {
    if (clientId) {
      const own = await this.templates.findOne({ where: { type, clientId } });
      if (own) return this.toResolved(own, 'CLIENTE');
    }
    const kubo = await this.templates.findOne({ where: { type, clientId: 0 } });
    if (kubo) return this.toResolved(kubo, 'KUBO_EDITADA');
    const entry = catalogEntry(type);
    return { type, clientId: null, source: 'KUBO', name: `Plantilla Kubo · ${entry?.name ?? type}`, sections: defaultTemplate(type) };
  }

  /** Las plantillas guardadas (Kubo editadas y de clientes), para la página de administración. */
  async listTemplates(): Promise<(ResolvedTemplate & { clientName: string | null; updatedAt: string })[]> {
    const rows = await this.templates.find({ order: { type: 'ASC', clientId: 'ASC' } });
    const ids = [...new Set(rows.map((r) => Number(r.clientId)).filter((x) => x > 0))];
    const names = new Map<number, string>();
    for (const id of ids) {
      const c = await this.clients.findOne({ where: { id } });
      if (c) names.set(id, c.razonSocial);
    }
    return rows.map((r) => ({
      ...this.toResolved(r, Number(r.clientId) ? 'CLIENTE' : 'KUBO_EDITADA'),
      clientName: Number(r.clientId) ? names.get(Number(r.clientId)) ?? null : null,
      updatedAt: new Date(r.updatedAt).toISOString(),
    }));
  }

  async getTemplate(type: string, clientId: number | null): Promise<ResolvedTemplate> {
    this.assertType(type);
    return this.resolveTemplate(type, clientId);
  }

  async saveTemplate(
    type: string,
    clientId: number | null,
    name: string,
    sections: unknown,
    actorUserId: number,
  ): Promise<ResolvedTemplate> {
    this.assertType(type);
    const clean = validateTemplate(sections);
    const n = String(name ?? '').trim();
    if (!n || n.length > 180) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'La plantilla necesita un nombre (hasta 180 caracteres).' });
    }
    const cid = clientId ?? 0;
    if (cid && !(await this.clients.findOne({ where: { id: cid } }))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ese cliente no existe.' });
    }
    const existing = await this.templates.findOne({ where: { type, clientId: cid } });
    const row = existing
      ? { ...existing, name: n, sectionsJson: JSON.stringify(clean), updatedBy: actorUserId }
      : this.templates.create({ type, clientId: cid, name: n, sectionsJson: JSON.stringify(clean), updatedBy: actorUserId });
    const saved = await this.templates.save(row);
    return this.toResolved(saved as DeliverableTemplate, cid ? 'CLIENTE' : 'KUBO_EDITADA');
  }

  /** Quitar la del cliente (vuelve a la de Kubo) o la de Kubo editada (vuelve a la del código). */
  async removeTemplate(type: string, clientId: number | null): Promise<void> {
    this.assertType(type);
    await this.templates.delete({ type, clientId: clientId ?? 0 });
  }

  // ------------------------------------------------------------ documento

  async getDocument(project: Project, deliverableId: number): Promise<DocumentView> {
    const loaded = await this.expediente.loadDocument(project, deliverableId);
    const d = loaded.deliverable;
    const template = await this.resolveTemplate(d.type, project.clientId ?? null);
    const sections = loaded.sections ?? sectionsFromTemplate(template.sections);
    return {
      deliverable: d,
      saved: loaded.sections != null,
      baseVersion: d.version,
      template: { source: template.source, name: template.name },
      sections: sections.map((s) => ({ ...s, status: sectionStatus(s.body) })),
      attachments: await this.listAttachments(project, deliverableId),
      attachmentsEditable: EDITABLE_ATTACHMENTS.includes(d.status),
    };
  }

  /**
   * Propone un ajuste con IA. No guarda nada: devuelve cada sección del
   * alcance con su antes y después; la persona acepta (todo o por sección) y
   * luego guarda, que es lo que crea la versión nueva.
   */
  async aiAdjust(
    project: Project,
    deliverableId: number,
    input: { scope: string; sectionKey?: string | null; instruction: string; sections: unknown },
  ): Promise<{ changes: AiChange[]; unchanged: string[] }> {
    const row = await this.expediente.deliverableOf(project, deliverableId);
    if (row.status === 'NO_APLICA') {
      throw new ConflictException({ code: 'INVALID_STATE', message: 'Este entregable está marcado como «no aplica».' });
    }
    const instruction = String(input.instruction ?? '').trim();
    if (!instruction) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Escribe qué quieres que ajuste la IA.' });
    if (instruction.length > MAX_INSTRUCTION) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: `El pedido admite hasta ${MAX_INSTRUCTION} caracteres.` });
    }
    const sections = validateSections(input.sections);
    let target: DocSection[];
    if (input.scope === 'SECTION') {
      const one = sections.find((s) => s.key === input.sectionKey);
      if (!one) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Elige la sección que quieres ajustar.' });
      target = [one];
    } else if (input.scope === 'DOCUMENT') {
      target = sections;
    } else {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'El alcance debe ser SECTION o DOCUMENT.' });
    }

    const client = project.clientId ? await this.clients.findOne({ where: { id: project.clientId } }) : null;
    const raw = await this.llm.chat(aiSystemPrompt(), [
      {
        role: 'user',
        content: aiUserPrompt({
          project: `${project.name} (${project.code})`,
          client: client?.razonSocial ?? null,
          deliverable: row.name,
          instruction,
          target,
          outline: sections,
        }),
      },
    ]);
    const proposed = parseAiSections(raw, target.map((s) => s.key));
    const changes: AiChange[] = [];
    const unchanged: string[] = [];
    for (const s of target) {
      const after = proposed.get(s.key);
      if (after == null || after.trim() === s.body.trim()) {
        unchanged.push(s.key);
        continue;
      }
      changes.push({ key: s.key, num: s.num, title: s.title, before: s.body, after, diff: wordDiff(s.body, after) });
    }
    return { changes, unchanged };
  }

  // ------------------------------------------------------------ imágenes

  async listAttachments(project: Project, deliverableId: number): Promise<AttachmentView[]> {
    const row = await this.expediente.deliverableOf(project, deliverableId);
    const rows = await this.attachments.find({ where: { deliverableId: row.id }, order: { position: 'ASC', id: 'ASC' } });
    return rows.map(toAttachmentView);
  }

  async addAttachment(
    project: Project,
    deliverableId: number,
    input: { sectionKey: string; place?: string; caption?: string | null },
    file: { buffer: Buffer } | null,
    actorUserId: number,
  ): Promise<AttachmentView> {
    const row = await this.assertAttachmentsEditable(project, deliverableId);
    if (!file?.buffer?.length) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Falta la imagen en el campo «file».' });
    const sectionKey = String(input.sectionKey ?? '');
    if (!KEY_RE.test(sectionKey)) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Sección inválida.' });
    const imageMime = imageMimeOf(file.buffer);
    const count = await this.attachments.count({ where: { deliverableId: row.id } });
    if (count >= 60) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Este documento ya tiene 60 imágenes.' });
    const saved = await this.attachments.save(
      this.attachments.create({
        deliverableId: row.id,
        sectionKey,
        place: placeOf(input.place),
        caption: captionOf(input.caption),
        position: count + 1,
        image: file.buffer,
        imageMime,
        createdByUserId: actorUserId,
      }),
    );
    return toAttachmentView(saved);
  }

  async updateAttachment(
    project: Project,
    deliverableId: number,
    attachmentId: number,
    patch: { caption?: string | null; place?: string; sectionKey?: string },
  ): Promise<AttachmentView> {
    const row = await this.assertAttachmentsEditable(project, deliverableId);
    const a = await this.findAttachment(row.id, attachmentId);
    if (patch.caption !== undefined) a.caption = captionOf(patch.caption);
    if (patch.place !== undefined) a.place = placeOf(patch.place);
    if (patch.sectionKey !== undefined) {
      if (!KEY_RE.test(String(patch.sectionKey))) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Sección inválida.' });
      a.sectionKey = String(patch.sectionKey);
    }
    // La imagen no se lee aquí (select: false): solo se actualizan los datos.
    await this.attachments.update({ id: a.id }, { caption: a.caption, place: a.place, sectionKey: a.sectionKey });
    return toAttachmentView(a);
  }

  async removeAttachment(project: Project, deliverableId: number, attachmentId: number): Promise<void> {
    const row = await this.assertAttachmentsEditable(project, deliverableId);
    const a = await this.findAttachment(row.id, attachmentId);
    await this.attachments.delete({ id: a.id });
    const rest = await this.attachments.find({ where: { deliverableId: row.id }, order: { position: 'ASC', id: 'ASC' } });
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].position !== i + 1) await this.attachments.update({ id: rest[i].id }, { position: i + 1 });
    }
  }

  async attachmentImage(project: Project, deliverableId: number, attachmentId: number): Promise<{ image: Buffer; mime: string }> {
    const row = await this.expediente.deliverableOf(project, deliverableId);
    const a = await this.attachments.findOne({
      where: { id: attachmentId, deliverableId: row.id },
      select: { id: true, image: true, imageMime: true },
    });
    if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Esa imagen no existe en este documento.' });
    return { image: a.image, mime: a.imageMime };
  }

  // ------------------------------------------------------------ apoyo

  private assertType(type: string) {
    if (!CATALOG.some((e) => e.type === type)) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: `Tipo de entregable desconocido: «${type}».` });
    }
  }

  private toResolved(r: DeliverableTemplate, source: TemplateSource): ResolvedTemplate {
    let sections: TemplateSection[];
    try {
      sections = validateTemplate(JSON.parse(r.sectionsJson));
    } catch {
      sections = defaultTemplate(r.type);
    }
    return { type: r.type, clientId: Number(r.clientId) || null, source, name: r.name, sections };
  }

  private async assertAttachmentsEditable(project: Project, deliverableId: number) {
    const row = await this.expediente.deliverableOf(project, deliverableId);
    if (!EDITABLE_ATTACHMENTS.includes(row.status)) {
      throw new ConflictException({
        code: 'INVALID_STATE',
        message: 'Las imágenes de un documento aprobado o firmado no cambian. Guarda una versión nueva para editarlas.',
      });
    }
    return row;
  }

  private async findAttachment(deliverableId: number, attachmentId: number): Promise<DeliverableAttachment> {
    const a = await this.attachments.findOne({ where: { id: attachmentId, deliverableId } });
    if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Esa imagen no existe en este documento.' });
    return a;
  }
}

function placeOf(v: unknown): AttachmentPlace {
  if (v === undefined || v === null || v === '') return 'INLINE';
  if (v === 'INLINE' || v === 'ANEXO') return v;
  throw new BadRequestException({ code: 'BAD_INPUT', message: 'La ubicación debe ser INLINE o ANEXO.' });
}

function captionOf(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim();
  if (s.length > 500) throw new BadRequestException({ code: 'BAD_INPUT', message: 'La leyenda admite hasta 500 caracteres.' });
  return s || null;
}

/** JPEG o PNG reales, hasta 5 MB y de dimensiones razonables (como los anexos del acta). */
function imageMimeOf(buf: Buffer): string {
  if (buf.length > MAX_ATTACHMENT_BYTES) {
    throw new BadRequestException({ code: 'BAD_INPUT', message: 'La imagen supera los 5 MB.' });
  }
  let mime: string | null = null;
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) mime = 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') mime = 'image/png';
  if (!mime) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Solo se admiten imágenes JPEG o PNG.' });
  assertImageDimensions(buf, 6000);
  return mime;
}

function toAttachmentView(a: DeliverableAttachment): AttachmentView {
  return {
    id: Number(a.id),
    sectionKey: a.sectionKey,
    place: a.place,
    caption: a.caption,
    position: Number(a.position),
    imageMime: a.imageMime,
  };
}
