import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Acta } from './entities/acta.entity';
import { ActaSignature } from './entities/acta-signature.entity';
import { UpdateActaDto } from './dto/update-acta.dto';
import { ActaTemplateService } from './services/acta-template.service';
import { PdfRendererService } from './services/pdf-renderer.service';
import { MeetingsService } from '../meetings/meetings.service';
import { ParticipantsService } from '../participants/participants.service';
import { AgendaService } from '../agenda/agenda.service';
import { TranscriptionsService } from '../transcriptions/transcriptions.service';
import { ProjectsService } from '../projects/projects.service';
import { LLMService } from '../ai/llm.service';
import { BacklogResult } from '../ai/llm.types';
import { IStorageService, STORAGE_SERVICE } from '../audio/interfaces/storage.interface';
import { IntegrationsService } from '../integrations/integrations.service';
import { JiraService, JiraExportResult } from '../integrations/jira.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { AudioRetentionService } from '../audio/services/audio-retention.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class ActasService {
  constructor(
    @InjectRepository(Acta) private readonly repo: Repository<Acta>,
    @InjectRepository(ActaSignature)
    private readonly signatures: Repository<ActaSignature>,
    private readonly template: ActaTemplateService,
    private readonly pdf: PdfRendererService,
    private readonly meetings: MeetingsService,
    private readonly participants: ParticipantsService,
    private readonly agenda: AgendaService,
    private readonly transcriptions: TranscriptionsService,
    private readonly projects: ProjectsService,
    private readonly llm: LLMService,
    private readonly integrations: IntegrationsService,
    private readonly jira: JiraService,
    private readonly workspace: WorkspaceService,
    private readonly audioRetention: AudioRetentionService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  async findByIdOrFail(id: number): Promise<Acta> {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Acta no encontrada' });
    return a;
  }

  findByMeeting(meetingId: number): Promise<Acta | null> {
    return this.repo.findOne({ where: { meetingId } });
  }

  async generateFromMeeting(meetingId: number, useAI = true): Promise<Acta> {
    const existing = await this.repo.findOne({ where: { meetingId } });
    if (existing && existing.status !== 'DRAFT') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: `El acta ya está en estado ${existing.status}`,
      });
    }

    const meeting = await this.meetings.findByIdOrFail(meetingId);
    const [participants, agenda, transcription] = await Promise.all([
      this.participants.listByMeeting(meetingId),
      this.agenda.listByMeeting(meetingId),
      this.transcriptions.findByMeeting(meetingId),
    ]);

    let body: string;
    let contentJson: Record<string, unknown> | null = null;

    if (useAI && transcription?.contentText) {
      const project = await this.projects.findById(Number(meeting.projectId));
      const draft = await this.llm.generateActaDraft({
        projectName: project.name,
        meetingTitle: meeting.title,
        meetingType: meeting.meetingType ?? 'GENERIC',
        scheduledAt: meeting.scheduledAt.toISOString(),
        location: meeting.location,
        participants: participants.map((p) => ({
          fullName: p.fullName,
          role: p.role,
          attended: !!p.attended,
        })),
        agenda: agenda.map((a) => ({ title: a.title, description: a.description ?? null })),
        transcription: transcription.contentText,
      });
      body = this.template.renderFromAI({ meeting, participants, draft });
      contentJson = draft as unknown as Record<string, unknown>;
    } else {
      body = this.template.render({
        meeting,
        participants,
        agenda,
        transcriptionText: transcription?.contentText ?? null,
      });
    }

    const acta =
      existing ??
      this.repo.create({
        meetingId,
        status: 'DRAFT',
        contentMarkdown: body,
        contentJson,
        generatedFromTranscription: transcription ? 1 : 0,
      });

    acta.contentMarkdown = body;
    acta.contentJson = contentJson;
    acta.generatedFromTranscription = transcription ? 1 : 0;
    const saved = await this.repo.save(acta);
    await this.meetings.setStatus(meetingId, 'ACTA_DRAFT');
    return saved;
  }

  async regenerateFromAI(actaId: number): Promise<Acta> {
    const acta = await this.findByIdOrFail(actaId);
    if (acta.status === 'APPROVED' || acta.status === 'EXPORTED') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'No se puede regenerar un acta aprobada',
      });
    }
    const meeting = await this.meetings.findByIdOrFail(Number(acta.meetingId));
    const [participants, agenda, transcription, project] = await Promise.all([
      this.participants.listByMeeting(Number(acta.meetingId)),
      this.agenda.listByMeeting(Number(acta.meetingId)),
      this.transcriptions.findByMeeting(Number(acta.meetingId)),
      this.projects.findById(Number(meeting.projectId)),
    ]);
    if (!transcription?.contentText) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'No hay transcripción disponible para regenerar',
      });
    }
    const draft = await this.llm.generateActaDraft({
      projectName: project.name,
      meetingTitle: meeting.title,
      meetingType: meeting.meetingType ?? 'GENERIC',
      scheduledAt: meeting.scheduledAt.toISOString(),
      location: meeting.location,
      participants: participants.map((p) => ({
        fullName: p.fullName,
        role: p.role,
        attended: !!p.attended,
      })),
      agenda: agenda.map((a) => ({ title: a.title, description: a.description ?? null })),
      transcription: transcription.contentText,
    });
    acta.contentMarkdown = this.template.renderFromAI({ meeting, participants, draft });
    acta.contentJson = draft as unknown as Record<string, unknown>;
    acta.version += 1;
    return this.repo.save(acta);
  }

  async generateBacklog(id: number): Promise<BacklogResult> {
    const acta = await this.findByIdOrFail(id);
    if (!acta.contentMarkdown?.trim()) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'El acta no tiene contenido para generar el backlog',
      });
    }

    const systemPrompt = [
      'Eres un experto Product Owner y Scrum Master.',
      'A partir del acta de reunión que recibirás, extrae y genera un product backlog estructurado.',
      'Tu respuesta debe ser ÚNICAMENTE un JSON válido con esta estructura EXACTA:',
      '{',
      '  "epics": [',
      '    {',
      '      "title": "nombre de la épica",',
      '      "description": "descripción breve de la épica",',
      '      "stories": [',
      '        {',
      '          "title": "Como [rol] quiero [acción] para [beneficio]",',
      '          "description": "contexto técnico adicional si aplica, sino vacío",',
      '          "acceptanceCriteria": ["Criterio verificable 1", "Criterio verificable 2"],',
      '          "priority": "Alta|Media|Baja",',
      '          "storyPoints": 3,',
      '          "assignee": "nombre del responsable o null",',
      '          "tasks": [',
      '            { "title": "Tarea técnica concreta", "assignee": "nombre o null" }',
      '          ]',
      '        }',
      '      ]',
      '    }',
      '  ]',
      '}',
      'Reglas estrictas:',
      '- Las historias DEBEN seguir el formato: "Como [rol] quiero [acción] para [beneficio]"',
      '- acceptanceCriteria debe tener al menos 2 criterios concretos y verificables',
      '- storyPoints debe ser Fibonacci: 1, 2, 3, 5, 8, 13. Usa null si no hay suficiente información',
      '- assignee toma el nombre del responsable mencionado en el acta, o null',
      '- Extrae SOLO lo que está en el acta, no inventes funcionalidades',
      '- Agrupa las historias en épicas temáticas coherentes',
      '- No incluyas ningún texto fuera del JSON, sin markdown alrededor',
    ].join('\n');

    const raw = await this.llm.chat(systemPrompt, [
      { role: 'user', content: `ACTA:\n\n${acta.contentMarkdown}` },
    ]);

    const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new BadGatewayException({
        code: 'LLM_ERROR',
        message: 'El proveedor de IA devolvió un JSON inválido al generar el backlog',
      });
    }

    const p = (parsed ?? {}) as Partial<BacklogResult>;
    return {
      epics: Array.isArray(p.epics)
        ? p.epics.map((e) => ({
            title: String(e?.title ?? ''),
            description: String(e?.description ?? ''),
            stories: Array.isArray(e?.stories)
              ? e.stories.map((s) => ({
                  title: String(s?.title ?? ''),
                  description: String(s?.description ?? ''),
                  acceptanceCriteria: Array.isArray(s?.acceptanceCriteria)
                    ? s.acceptanceCriteria.map(String)
                    : [],
                  priority: (['Alta', 'Media', 'Baja'] as const).includes(s?.priority as never)
                    ? (s.priority as 'Alta' | 'Media' | 'Baja')
                    : 'Media',
                  storyPoints: typeof s?.storyPoints === 'number' ? s.storyPoints : null,
                  assignee: typeof s?.assignee === 'string' ? s.assignee : null,
                  tasks: Array.isArray(s?.tasks)
                    ? s.tasks.map((t) => ({
                        title: String(t?.title ?? ''),
                        assignee: typeof t?.assignee === 'string' ? t.assignee : null,
                      }))
                    : [],
                }))
              : [],
          }))
        : [],
    };
  }

  async exportToJira(
    actaId: number,
    integrationId: number,
    projectKey: string,
    backlog: BacklogResult,
  ): Promise<JiraExportResult> {
    await this.findByIdOrFail(actaId);
    const integration = await this.integrations.findByIdOrFail(integrationId);
    const auth = this.integrations.getJiraAuth(integration);
    return this.jira.exportBacklog(auth, projectKey, backlog);
  }

  async update(id: number, dto: UpdateActaDto): Promise<Acta> {
    const acta = await this.findByIdOrFail(id);
    if (acta.status === 'APPROVED' || acta.status === 'EXPORTED') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'No se puede editar un acta aprobada',
      });
    }
    if (dto.contentMarkdown !== undefined) acta.contentMarkdown = dto.contentMarkdown;
    acta.version += 1;
    return this.repo.save(acta);
  }

  async submitReview(id: number): Promise<Acta> {
    const acta = await this.findByIdOrFail(id);
    if (acta.status !== 'DRAFT') {
      throw new BadRequestException({ code: 'CONFLICT', message: 'Solo se puede enviar a revisión un DRAFT' });
    }
    acta.status = 'IN_REVIEW';
    return this.repo.save(acta);
  }

  async approve(id: number, user: AuthUser): Promise<Acta> {
    const acta = await this.findByIdOrFail(id);
    if (!['DRAFT', 'IN_REVIEW'].includes(acta.status)) {
      throw new BadRequestException({ code: 'CONFLICT', message: 'Estado inválido para aprobar' });
    }
    if (!['ADMIN', 'PRODUCT_OWNER', 'SCRUM_MASTER'].includes(user.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Solo ADMIN, Product Owner o Scrum Master pueden aprobar',
      });
    }

    acta.status = 'APPROVED';
    acta.approvedBy = user.id;
    acta.approvedAt = new Date();
    await this.repo.save(acta);
    await this.meetings.setStatus(acta.meetingId, 'ACTA_APPROVED');

    const buffer = await this.renderPdfBuffer(acta);
    const key = `actas/${acta.meetingId}/acta_${acta.id}_v${acta.version}.pdf`;
    await this.storage.save(buffer, key, 'application/pdf');
    acta.exportedPdfKey = key;
    acta.status = 'EXPORTED';
    const saved = await this.repo.save(acta);

    // Hook: política DELETE_AFTER_APPROVAL borra el audio tras aprobar.
    try {
      await this.audioRetention.onActaApproved(Number(acta.meetingId));
    } catch {
      // no rompemos el aprobar si falla la retención
    }

    return saved;
  }

  async getPdfBuffer(id: number): Promise<Buffer> {
    const acta = await this.findByIdOrFail(id);
    return this.renderPdfBuffer(acta);
  }

  private async renderPdfBuffer(acta: Acta): Promise<Buffer> {
    const meeting = await this.meetings.findByIdOrFail(Number(acta.meetingId));
    const [project, sigs, emisor, emisorLogoBuffer] = await Promise.all([
      this.projects.findById(Number(meeting.projectId)).catch(() => null),
      this.signatures.find({
        where: { actaId: acta.id },
        order: { signedAt: 'ASC' },
      }),
      this.workspace.get().catch(() => null),
      this.workspace.getLogoBuffer().catch(() => null),
    ]);
    return this.pdf.renderWith({
      acta,
      meetingTitle: meeting.title,
      projectName: project?.name ?? null,
      signatures: sigs,
      emisor,
      emisorLogoBuffer,
    });
  }
}
