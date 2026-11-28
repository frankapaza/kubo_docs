import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EntityManager, In, IsNull, Not, Repository } from 'typeorm';

import { buildZip, ZipEntry } from '../../../common/zip/zip-writer';
import { IStorageService, STORAGE_SERVICE } from '../../audio/interfaces/storage.interface';
import { sanitizeFilename, toHeaderFilename } from '../../ticket-messages/ticket-attachments.service';
import { Client } from '../../clients/entities/client.entity';
import { User } from '../../users/entities/user.entity';
import { Project } from '../entities/project.entity';
import {
  CATALOG,
  DeliverableAction,
  DeliverableStatus,
  PHASES,
  PHASE_LABELS,
  Phase,
  STATUS_LABELS,
  Version,
  WORK_TYPE_LABELS,
  WorkType,
  approvedVersion,
  assertTransition,
  autoNaReason,
  catalogEntry,
  nextWorkingVersion,
  nomenclature,
  projectCodeSlug,
  requirementFor,
  versionLabel,
} from './deliverable-catalog';
import { DocSection, parseStoredSections, validateSections } from './deliverable-document';
import { assertDeliverableFile, deliverableExtension } from './deliverable-files';
import { DeliverablePdfRenderer } from './deliverable-pdf.renderer';
import { DeliverableAttachment } from './entities/deliverable-attachment.entity';
import { ProjectDeliverable } from './entities/project-deliverable.entity';
import { DeliverableHistoryAction, ProjectDeliverableVersion } from './entities/project-deliverable-version.entity';

export interface DeliverableFileView {
  versionId: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DeliverableView {
  id: number;
  correlative: number;
  type: string;
  name: string;
  phase: Phase;
  phaseLabel: string;
  requirement: 'O' | 'OP' | 'NA';
  status: DeliverableStatus;
  statusLabel: string;
  naReason: string | null;
  autoNa: boolean;
  fromCatalog: boolean;
  version: string | null;
  nomenclature: string;
  lastFile: DeliverableFileView | null;
  /** Versión del historial con el último documento en línea, si se redactó en la plataforma. */
  documentVersionId: number | null;
  /** Qué es lo vigente: el último archivo subido o el documento en línea (el más reciente de los dos). */
  current: 'FILE' | 'DOCUMENT' | null;
  updatedAt: string;
}

export interface LoadedDocument {
  deliverable: DeliverableView;
  /** null si todavía no se redactó en la plataforma. */
  sections: DocSection[] | null;
  versionId: number | null;
}

export interface ExpedienteSummary {
  total: number;
  required: number;
  approved: number;
  inProgress: number;
  pending: number;
  notApplicable: number;
  phases: { phase: Phase; label: string; total: number; done: number }[];
}

export interface ExpedienteView {
  project: { id: number; code: string; name: string; workType: WorkType | null; workTypeLabel: string | null };
  deliverables: DeliverableView[];
  summary: ExpedienteSummary;
}

export interface HistoryView {
  id: number;
  action: DeliverableHistoryAction;
  actionLabel: string;
  version: string | null;
  note: string | null;
  file: { filename: string; mimeType: string; sizeBytes: number } | null;
  actorUserId: number | null;
  actorName: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<DeliverableHistoryAction, string> = {
  E: 'Elaborado',
  R: 'Revisado',
  A: 'Aprobado',
  F: 'Firmado',
  N: 'No aplica',
  P: 'Reabierto',
};

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Ese entregable no existe en este proyecto.' } as const;
const CHANGED = {
  code: 'CONFLICT',
  message: 'El entregable cambió mientras tanto (otra persona lo actualizó). Recarga e inténtalo de nuevo.',
} as const;
const NO_SE_PUDO_GUARDAR = { code: 'STORAGE_ERROR', message: 'No se pudo guardar el archivo. Inténtalo de nuevo.' } as const;

/** Tope del .zip del expediente, para no armar en memoria algo desmedido. */
export const MAX_ZIP_BYTES = 150 * 1024 * 1024;

export interface UploadInput {
  buffer: Buffer;
  filename: string;
  note?: string | null;
}

/**
 * El expediente del proyecto: al elegir el tipo de trabajo se crean los
 * entregables del catálogo con su obligatoriedad; cada uno avanza por
 * borrador → revisión → aprobado → firmado, con su historial de versiones y
 * sus archivos. El acceso al proyecto lo comprueba el controlador antes de
 * llamar aquí (`ProjectsService.findByIdForUser`).
 */
@Injectable()
export class ExpedienteService {
  private readonly logger = new Logger(ExpedienteService.name);
  private zipping = false;

  constructor(
    @InjectRepository(ProjectDeliverable) private readonly deliverables: Repository<ProjectDeliverable>,
    @InjectRepository(ProjectDeliverableVersion) private readonly versions: Repository<ProjectDeliverableVersion>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
    @InjectRepository(DeliverableAttachment) private readonly attachments: Repository<DeliverableAttachment>,
    @InjectRepository(Client) private readonly clients: Repository<Client>,
  ) {}

  private readonly pdf = new DeliverablePdfRenderer();

  async get(project: Project): Promise<ExpedienteView> {
    const rows = await this.deliverables.find({
      where: { projectId: project.id },
      order: { correlative: 'ASC' },
    });
    const ids = rows.map((r) => Number(r.id));
    const files = await this.lastFiles(ids);
    const docs = await this.lastDocuments(ids);
    const views = rows.map((r) => this.toView(project, r, files.get(Number(r.id)) ?? null, docs.get(Number(r.id)) ?? null));
    const workType = (project.workType ?? null) as WorkType | null;
    return {
      project: {
        id: Number(project.id),
        code: project.code,
        name: project.name,
        workType,
        workTypeLabel: workType ? WORK_TYPE_LABELS[workType] : null,
      },
      deliverables: views,
      summary: summarize(views),
    };
  }

  /**
   * Elegir (o cambiar) el tipo de trabajo. La primera vez crea los 20
   * entregables del catálogo. Al cambiarlo, recalcula la obligatoriedad de los
   * del catálogo; los que pasan a «no aplica» y no se han trabajado se marcan
   * solos, y los que estaban así por el tipo anterior vuelven a pendientes.
   * Un «no aplica» puesto a mano no se toca.
   */
  async setWorkType(project: Project, workType: WorkType, actorUserId: number): Promise<ExpedienteView> {
    await this.projects.manager.transaction(async (m) => {
      // Bloquea el proyecto: dos personas eligiendo el tipo a la vez no crean el catálogo dos veces.
      await m.getRepository(Project).findOne({ where: { id: project.id }, lock: { mode: 'pessimistic_write' } });
      await m.getRepository(Project).update({ id: project.id }, { workType });
      const repo = m.getRepository(ProjectDeliverable);
      const existing = await repo.find({ where: { projectId: project.id }, lock: { mode: 'pessimistic_write' } });

      if (existing.length === 0) {
        let n = 0;
        for (const entry of CATALOG) {
          const requirement = requirementFor(entry, workType);
          n++;
          await repo.insert({
            projectId: project.id,
            correlative: n,
            type: entry.type,
            name: entry.name,
            phase: entry.phase,
            requirement,
            status: requirement === 'NA' ? 'NO_APLICA' : 'PENDIENTE',
            naReason: requirement === 'NA' ? autoNaReason(workType) : null,
            autoNa: requirement === 'NA' ? 1 : 0,
            fromCatalog: 1,
            versionMajor: 0,
            versionMinor: 0,
          });
        }
        return;
      }

      for (const row of existing) {
        if (!row.fromCatalog) continue;
        const entry = catalogEntry(row.type);
        if (!entry) continue;
        const requirement = requirementFor(entry, workType);
        const patch: Partial<ProjectDeliverable> = { requirement };
        if (requirement === 'NA' && row.status === 'PENDIENTE') {
          Object.assign(patch, { status: 'NO_APLICA', naReason: autoNaReason(workType), autoNa: 1 });
        } else if (row.autoNa && row.status === 'NO_APLICA' && requirement !== 'NA') {
          Object.assign(patch, { status: 'PENDIENTE', naReason: null, autoNa: 0 });
        } else if (row.autoNa && row.status === 'NO_APLICA') {
          patch.naReason = autoNaReason(workType);
        }
        // Condicional: si alguien subió una versión entre la lectura y aquí, esa fila no se toca.
        await repo.update(
          { id: row.id, status: row.status, versionMajor: row.versionMajor, versionMinor: row.versionMinor },
          patch,
        );
      }
    });
    this.logger.log(`Proyecto ${project.id}: tipo de trabajo ${workType} (usuario ${actorUserId}).`);
    return this.get({ ...project, workType } as Project);
  }

  /** Otro entregable del mismo tipo (una segunda acta de reunión, otra solicitud de cambio). */
  async add(project: Project, type: string, title: string | null): Promise<DeliverableView> {
    if (!project.workType) {
      throw new ConflictException({ code: 'INVALID_STATE', message: 'Primero elige el tipo de trabajo del proyecto.' });
    }
    const entry = catalogEntry(type);
    if (!entry) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: `Tipo de entregable desconocido: «${type}».` });
    }
    const name = (title?.trim() || entry.name).slice(0, 180);
    const id = await this.deliverables.manager.transaction(async (m) => {
      const repo = m.getRepository(ProjectDeliverable);
      const last = await repo.findOne({
        where: { projectId: project.id },
        order: { correlative: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      const res = await repo.insert({
        projectId: project.id,
        correlative: Number(last?.correlative ?? 0) + 1,
        type: entry.type,
        name,
        phase: entry.phase,
        requirement: 'OP',
        status: 'PENDIENTE',
        naReason: null,
        autoNa: 0,
        fromCatalog: 0,
        versionMajor: 0,
        versionMinor: 0,
      });
      return Number(res.identifiers[0].id);
    });
    return this.view(project, id);
  }

  /** Solo uno agregado a mano y sin historial: los del catálogo se marcan «no aplica». */
  async remove(project: Project, deliverableId: number): Promise<void> {
    const row = await this.findOrFail(project, deliverableId);
    if (row.fromCatalog) {
      throw new ConflictException({
        code: 'INVALID_STATE',
        message: 'Los entregables del catálogo no se borran; márcalo como «no aplica» con su motivo.',
      });
    }
    const history = await this.versions.count({ where: { deliverableId: row.id } });
    if (history > 0) {
      throw new ConflictException({ code: 'INVALID_STATE', message: 'Ese entregable ya tiene historial; no se puede borrar.' });
    }
    // Condicional: si recibió una versión entre la comprobación y aquí, no se borra su historial.
    const res = await this.deliverables.delete({ id: row.id, status: 'PENDIENTE', versionMajor: 0, versionMinor: 0 });
    if (!res.affected) throw new ConflictException(CHANGED);
  }

  async history(project: Project, deliverableId: number): Promise<HistoryView[]> {
    const row = await this.findOrFail(project, deliverableId);
    const rows = await this.versions.find({ where: { deliverableId: row.id }, order: { id: 'ASC' } });
    const ids = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is number => x != null).map(Number))];
    const names = new Map<number, string>();
    if (ids.length) {
      for (const u of await this.users.find({ where: { id: In(ids) }, select: { id: true, fullName: true } })) {
        names.set(Number(u.id), u.fullName);
      }
    }
    return rows.map((r) => ({
      id: Number(r.id),
      action: r.action,
      actionLabel: ACTION_LABELS[r.action] ?? r.action,
      version: versionLabel({ major: r.versionMajor, minor: r.versionMinor }),
      note: r.note,
      file:
        r.storageKey && r.filename && r.mimeType
          ? { filename: r.filename, mimeType: r.mimeType, sizeBytes: Number(r.sizeBytes ?? 0) }
          : null,
      actorUserId: r.actorUserId == null ? null : Number(r.actorUserId),
      actorName: r.actorUserId == null ? null : names.get(Number(r.actorUserId)) ?? null,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }

  /** Una versión de trabajo nueva (E): 0.1, 0.2… o 1.1 tras aprobar. Queda en borrador. */
  upload(project: Project, deliverableId: number, file: UploadInput, actorUserId: number): Promise<DeliverableView> {
    return this.act(project, deliverableId, 'UPLOAD', actorUserId, { file, note: file.note ?? null });
  }

  submit(project: Project, deliverableId: number, note: string | null, actorUserId: number) {
    return this.act(project, deliverableId, 'SUBMIT', actorUserId, { note });
  }

  async observe(project: Project, deliverableId: number, note: string | null, actorUserId: number) {
    if (!note?.trim()) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Escribe qué hay que corregir.' });
    }
    return this.act(project, deliverableId, 'OBSERVE', actorUserId, { note });
  }

  approve(project: Project, deliverableId: number, note: string | null, actorUserId: number) {
    return this.act(project, deliverableId, 'APPROVE', actorUserId, { note });
  }

  /** Firmado: opcionalmente con el escaneo o el PDF firmado. Mantiene la versión aprobada. */
  sign(project: Project, deliverableId: number, file: UploadInput | null, note: string | null, actorUserId: number) {
    return this.act(project, deliverableId, 'SIGN', actorUserId, { file, note });
  }

  async notApplicable(project: Project, deliverableId: number, reason: string | null, actorUserId: number) {
    if (!reason?.trim()) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Indica por qué no aplica.' });
    }
    return this.act(project, deliverableId, 'NOT_APPLICABLE', actorUserId, { note: reason });
  }

  reopen(project: Project, deliverableId: number, actorUserId: number) {
    return this.act(project, deliverableId, 'REOPEN', actorUserId, { note: null });
  }

  /** El archivo de una fila del historial. */
  async download(project: Project, deliverableId: number, versionId: number) {
    const row = await this.findOrFail(project, deliverableId);
    const v = await this.versions.findOneBy({ id: versionId, deliverableId: row.id });
    if (!v || !v.storageKey || !v.filename || !v.mimeType) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Esa versión no tiene archivo.' });
    }
    const stream = this.storage.createReadStream(v.storageKey);
    stream.on('error', (cause: Error) => this.logger.error(`No se pudo leer «${v.storageKey}».`, cause));
    return {
      stream,
      filename: v.filename,
      headerFilename: toHeaderFilename(v.filename),
      mimeType: v.mimeType,
      size: Number(v.sizeBytes ?? 0),
    };
  }

  /** El entregable dentro del proyecto (o 404), para el editor. */
  async deliverableOf(project: Project, deliverableId: number): Promise<ProjectDeliverable> {
    return this.findOrFail(project, deliverableId);
  }

  /** El último documento en línea del entregable, si lo hay. */
  async loadDocument(project: Project, deliverableId: number): Promise<LoadedDocument> {
    const deliverable = await this.view(project, deliverableId);
    if (deliverable.documentVersionId == null) return { deliverable, sections: null, versionId: null };
    const v = await this.versions.findOne({
      where: { id: deliverable.documentVersionId },
      select: { id: true, contentJson: true },
    });
    return { deliverable, sections: parseStoredSections(v?.contentJson ?? null), versionId: deliverable.documentVersionId };
  }

  /**
   * Guarda el documento en línea como una versión de trabajo nueva (E, +0.1).
   * `baseVersion` es la versión sobre la que se editó («0.2», o null si era la
   * primera): si otra persona guardó entre medio, 409 y no se pisa.
   */
  async saveDocument(
    project: Project,
    deliverableId: number,
    sections: unknown,
    baseVersion: string | null,
    note: string | null,
    actorUserId: number,
  ): Promise<DeliverableView> {
    const content = validateSections(sections);
    const m = /^(\d+)\.(\d+)$/.exec(baseVersion ?? '');
    const expected = m ? { major: Number(m[1]), minor: Number(m[2]) } : { major: 0, minor: 0 };
    return this.act(project, deliverableId, 'UPLOAD', actorUserId, { note, content, expected });
  }

  /** El PDF del documento en línea (carátula, historial, índice, secciones, figuras y anexos). */
  async renderDocumentPdf(project: Project, deliverableId: number): Promise<{ buffer: Buffer; filename: string }> {
    const doc = await this.loadDocument(project, deliverableId);
    if (!doc.sections) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Este entregable todavía no tiene un documento redactado.' });
    }
    const d = doc.deliverable;
    const [history, images, client] = await Promise.all([
      this.history(project, deliverableId),
      this.attachments.find({
        where: { deliverableId: d.id },
        select: { id: true, sectionKey: true, place: true, caption: true, image: true, position: true },
        order: { position: 'ASC', id: 'ASC' },
      }),
      project.clientId ? this.clients.findOne({ where: { id: project.clientId } }) : Promise.resolve(null),
    ]);
    const buffer = await this.pdf.render({
      title: d.name,
      nomenclature: d.nomenclature,
      version: d.version,
      statusLabel: d.statusLabel,
      projectName: project.name,
      projectCode: project.code,
      clientName: client?.razonSocial ?? null,
      sections: doc.sections,
      history: history.filter((h) => ['E', 'R', 'A', 'F'].includes(h.action)),
      attachments: images.map((a) => ({ sectionKey: a.sectionKey, place: a.place, caption: a.caption, image: a.image })),
    });
    return { buffer, filename: `${d.nomenclature}.pdf` };
  }

  /**
   * El expediente en un .zip: el último archivo de cada entregable, con su
   * nombre de nomenclatura, en una carpeta por fase, más `indice.csv`.
   */
  async zip(project: Project): Promise<{ buffer: Buffer; filename: string; headerFilename: string }> {
    // Un .zip se arma en memoria: uno a la vez por proceso, para que varios clics no la agoten.
    if (this.zipping) {
      throw new HttpException(
        { code: 'TOO_MANY_REQUESTS', message: 'Ya se está preparando un expediente. Inténtalo en un momento.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.zipping = true;
    try {
      return await this.buildExpedienteZip(project);
    } finally {
      this.zipping = false;
    }
  }

  private async buildExpedienteZip(project: Project): Promise<{ buffer: Buffer; filename: string; headerFilename: string }> {
    const view = await this.get(project);
    const withFile = view.deliverables.filter((d) => d.lastFile && d.current === 'FILE');
    const withDocument = view.deliverables.filter((d) => d.current === 'DOCUMENT');
    const total = withFile.reduce((n, d) => n + (d.lastFile?.sizeBytes ?? 0), 0);
    if (total > MAX_ZIP_BYTES) {
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: `El expediente pesa más de ${MAX_ZIP_BYTES / (1024 * 1024)} MB; descarga los documentos por separado.`,
      });
    }
    const keys = await this.versions.find({
      where: { id: In(withFile.map((d) => d.lastFile!.versionId)) },
      select: { id: true, storageKey: true },
    });
    const keyOf = new Map(keys.map((k) => [Number(k.id), k.storageKey]));

    const entries: ZipEntry[] = [];
    const paths = new Map<number, string>();
    for (const d of withFile) {
      const f = d.lastFile!;
      const key = keyOf.get(f.versionId);
      if (!key) continue;
      const ext = deliverableExtension(f.mimeType);
      const folder = `${PHASES.indexOf(d.phase) + 1}. ${PHASE_LABELS[d.phase]}`;
      const path = `${folder}/${d.nomenclature}.${ext}`;
      try {
        // PDF, Office e imágenes ya vienen comprimidos: se guardan tal cual (deflate no ahorra y bloquea).
        entries.push({ name: path, data: await this.readAll(key), compress: f.mimeType === 'application/vnd.ms-project' });
        paths.set(d.id, path);
      } catch (cause) {
        this.logger.error(`No se pudo leer «${key}» para el expediente.`, cause as Error);
      }
    }
    for (const d of withDocument) {
      const folder = `${PHASES.indexOf(d.phase) + 1}. ${PHASE_LABELS[d.phase]}`;
      const path = `${folder}/${d.nomenclature}.pdf`;
      try {
        entries.push({ name: path, data: (await this.renderDocumentPdf(project, d.id)).buffer, compress: false });
        paths.set(d.id, path);
      } catch (cause) {
        this.logger.error(`No se pudo armar el PDF del entregable ${d.id} para el expediente.`, cause as Error);
      }
    }
    entries.push({ name: 'indice.csv', data: indexCsv(view, paths) });

    const date = new Date().toISOString().slice(0, 10);
    const filename = `KUBO-${projectCodeSlug(project.code)}-Expediente-${date}.zip`;
    return { buffer: buildZip(entries), filename, headerFilename: filename };
  }

  // ------------------------------------------------------------------

  private async act(
    project: Project,
    deliverableId: number,
    action: DeliverableAction,
    actorUserId: number,
    input: { file?: UploadInput | null; note: string | null; content?: DocSection[] | null; expected?: Version | null },
  ): Promise<DeliverableView> {
    const row = await this.findOrFail(project, deliverableId);
    assertTransition(row.status, action);
    const current: Version = { major: row.versionMajor, minor: row.versionMinor };
    if (input.expected && (input.expected.major !== current.major || input.expected.minor !== current.minor)) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Otra persona guardó la versión ${versionLabel(current) ?? ''} mientras editabas. Recarga para ver sus cambios; tu texto sigue en pantalla.`,
      });
    }
    if (action === 'SUBMIT' && current.major === 0 && current.minor === 0) {
      throw new ConflictException({ code: 'INVALID_STATE', message: 'Sube primero una versión del documento.' });
    }
    if (action === 'APPROVE' && current.minor === 0) {
      throw new ConflictException({ code: 'INVALID_STATE', message: 'No hay una versión de trabajo nueva para aprobar.' });
    }

    let next: Version = current;
    let status: DeliverableStatus = row.status;
    let hist: DeliverableHistoryAction;
    const extra: Partial<ProjectDeliverable> = {};
    switch (action) {
      case 'UPLOAD':
        next = nextWorkingVersion(current);
        status = 'BORRADOR';
        hist = 'E';
        break;
      case 'SUBMIT':
        status = 'EN_REVISION';
        hist = 'R';
        break;
      case 'OBSERVE':
        status = 'BORRADOR';
        hist = 'R';
        break;
      case 'APPROVE':
        next = approvedVersion(current);
        status = 'APROBADO';
        hist = 'A';
        break;
      case 'SIGN':
        status = 'FIRMADO';
        hist = 'F';
        break;
      case 'NOT_APPLICABLE':
        status = 'NO_APLICA';
        hist = 'N';
        Object.assign(extra, { naReason: input.note!.trim().slice(0, 300), autoNa: 0 });
        break;
      case 'REOPEN':
        status = 'PENDIENTE';
        hist = 'P';
        Object.assign(extra, { naReason: null, autoNa: 0 });
        break;
    }

    // El archivo va al disco antes que la fila; si la fila falla, se borra.
    let stored: { key: string; filename: string; mimeType: string; size: number } | null = null;
    if (input.file) {
      const { mimeType, ext } = assertDeliverableFile(input.file.buffer, input.file.filename);
      const key = `projects/${numeric(project.id)}/deliverables/${numeric(row.id)}/${randomUUID()}.${ext}`;
      try {
        await this.storage.save(input.file.buffer, key, mimeType);
      } catch (cause) {
        this.logger.error(`No se pudo escribir «${key}».`, cause as Error);
        throw new InternalServerErrorException(NO_SE_PUDO_GUARDAR);
      }
      stored = {
        key,
        filename: sanitizeFilename(input.file.filename).slice(0, 255),
        mimeType,
        size: input.file.buffer.length,
      };
    } else if (action === 'UPLOAD' && !input.content) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Falta el archivo en el campo «file».' });
    }

    try {
      await this.deliverables.manager.transaction(async (m: EntityManager) => {
        // Condicional: si otra persona movió el entregable entre la lectura y aquí, no se pisa.
        const res = await m.getRepository(ProjectDeliverable).update(
          { id: row.id, status: row.status, versionMajor: current.major, versionMinor: current.minor },
          { status, versionMajor: next.major, versionMinor: next.minor, ...extra },
        );
        if (!res.affected) throw new ConflictException(CHANGED);
        await m.getRepository(ProjectDeliverableVersion).insert({
          deliverableId: row.id,
          action: hist,
          versionMajor: next.major,
          versionMinor: next.minor,
          note: input.note?.trim() ? input.note.trim().slice(0, 1000) : null,
          storageKey: stored?.key ?? null,
          filename: stored?.filename ?? null,
          mimeType: stored?.mimeType ?? null,
          sizeBytes: stored?.size ?? null,
          contentJson: input.content ? JSON.stringify({ sections: input.content }) : null,
          actorUserId,
        });
      });
    } catch (e) {
      if (stored) {
        await this.storage.remove(stored.key).catch((err) =>
          this.logger.error(`Quedó un archivo huérfano: «${stored!.key}».`, err as Error),
        );
      }
      throw e;
    }
    return this.view(project, Number(row.id));
  }

  private async view(project: Project, id: number): Promise<DeliverableView> {
    const row = await this.findOrFail(project, id);
    const files = await this.lastFiles([Number(row.id)]);
    const docs = await this.lastDocuments([Number(row.id)]);
    return this.toView(project, row, files.get(Number(row.id)) ?? null, docs.get(Number(row.id)) ?? null);
  }

  /** El último documento en línea de cada entregable (solo el id de la versión). */
  private async lastDocuments(ids: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (!ids.length) return out;
    const rows = await this.versions.find({
      where: { deliverableId: In(ids), contentJson: Not(IsNull()) },
      select: { id: true, deliverableId: true },
      order: { id: 'DESC' },
    });
    for (const r of rows) if (!out.has(Number(r.deliverableId))) out.set(Number(r.deliverableId), Number(r.id));
    return out;
  }

  private async findOrFail(project: Project, deliverableId: number): Promise<ProjectDeliverable> {
    const row = await this.deliverables.findOneBy({ id: deliverableId, projectId: project.id });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /** El último archivo subido de cada entregable. */
  private async lastFiles(ids: number[]): Promise<Map<number, DeliverableFileView>> {
    const out = new Map<number, DeliverableFileView>();
    if (!ids.length) return out;
    const rows = await this.versions.find({
      where: { deliverableId: In(ids), storageKey: Not(IsNull()) },
      select: { id: true, deliverableId: true, filename: true, mimeType: true, sizeBytes: true },
      order: { id: 'DESC' },
    });
    for (const r of rows) {
      const id = Number(r.deliverableId);
      if (out.has(id)) continue;
      out.set(id, {
        versionId: Number(r.id),
        filename: r.filename ?? 'archivo',
        mimeType: r.mimeType ?? 'application/octet-stream',
        sizeBytes: Number(r.sizeBytes ?? 0),
      });
    }
    return out;
  }

  private toView(
    project: Project,
    r: ProjectDeliverable,
    lastFile: DeliverableFileView | null,
    documentVersionId: number | null = null,
  ): DeliverableView {
    const v = { major: Number(r.versionMajor), minor: Number(r.versionMinor) };
    return {
      id: Number(r.id),
      correlative: Number(r.correlative),
      type: r.type,
      name: r.name,
      phase: r.phase,
      phaseLabel: PHASE_LABELS[r.phase] ?? r.phase,
      requirement: r.requirement,
      status: r.status,
      statusLabel: STATUS_LABELS[r.status] ?? r.status,
      naReason: r.naReason,
      autoNa: Boolean(r.autoNa),
      fromCatalog: Boolean(r.fromCatalog),
      version: versionLabel(v),
      nomenclature: nomenclature(project.code, Number(r.correlative), r.type, v),
      lastFile,
      documentVersionId,
      current:
        documentVersionId != null && (!lastFile || documentVersionId > lastFile.versionId)
          ? 'DOCUMENT'
          : lastFile
            ? 'FILE'
            : null,
      updatedAt: new Date(r.updatedAt).toISOString(),
    };
  }

  private async readAll(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of this.storage.createReadStream(key) as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
    return Buffer.concat(chunks);
  }
}

export function summarize(views: DeliverableView[]): ExpedienteSummary {
  const active = views.filter((d) => d.status !== 'NO_APLICA');
  const done = (d: DeliverableView) => d.status === 'APROBADO' || d.status === 'FIRMADO';
  return {
    total: active.length,
    required: active.filter((d) => d.requirement === 'O').length,
    approved: active.filter(done).length,
    inProgress: active.filter((d) => d.status === 'BORRADOR' || d.status === 'EN_REVISION').length,
    pending: active.filter((d) => d.status === 'PENDIENTE').length,
    notApplicable: views.length - active.length,
    phases: PHASES.map((phase) => {
      const list = active.filter((d) => d.phase === phase);
      return { phase, label: PHASE_LABELS[phase], total: list.length, done: list.filter(done).length };
    }),
  };
}

/** `;` y BOM: así lo abre bien el Excel en español. Las celdas que empiezan con =, +, - o @ se neutralizan. */
export function indexCsv(view: ExpedienteView, paths: Map<number, string>): Buffer {
  const cell = (v: string | number | null) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const REQ = { O: 'Obligatorio', OP: 'Opcional', NA: 'No aplica' } as const;
  const lines = [
    ['Correlativo', 'Código', 'Entregable', 'Fase', 'Obligatoriedad', 'Estado', 'Versión', 'Nomenclatura', 'Archivo en el expediente', 'Motivo (no aplica)'],
    ...view.deliverables.map((d) => [
      String(d.correlative).padStart(4, '0'),
      d.type,
      d.name,
      d.phaseLabel,
      REQ[d.requirement],
      d.statusLabel,
      d.version ?? '',
      d.nomenclature,
      paths.get(d.id) ?? '',
      d.naReason ?? '',
    ]),
  ];
  return Buffer.from('﻿' + lines.map((l) => l.map(cell).join(';')).join('\r\n') + '\r\n', 'utf8');
}

function numeric(v: number | string): string {
  const s = String(v);
  if (!/^[0-9]+$/.test(s)) throw new InternalServerErrorException(NO_SE_PUDO_GUARDAR);
  return s;
}
