import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'stream';

import { ClientRequestsRepository } from './client-requests.repository';
import {
  ClientRequest,
  ClientRequestPriority,
  ClientRequestStatus,
  ClientRequestType,
  ServiceCategory,
} from './entities/client-request.entity';
import { CreateClientRequestDto } from './dto/create-client-request.dto';
import { UpdateClientRequestDto } from './dto/update-client-request.dto';

import { ClientsService } from '../clients/clients.service';
import { ProjectsService } from '../projects/projects.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { JiraService } from '../integrations/jira.service';
import { LLMService } from '../ai/llm.service';
import {
  ITranscriptionProvider,
  TRANSCRIPTION_PROVIDER,
} from '../transcriptions/interfaces/transcription-provider.interface';
import { DocumentsService } from '../documents/documents.service';

interface StructuredPayload {
  requestType: ClientRequestType;
  priority: ClientRequestPriority;
  moduleName: string | null;
  screenName: string | null;
  flowContext: string | null;
  title: string;
  descriptionMd: string;
  acceptanceCriteria: string[];
  labels: string[];
}

const VALID_TYPES: ClientRequestType[] = ['MEJORA', 'FEATURE', 'AJUSTE', 'BUG'];
const VALID_PRIORITIES: ClientRequestPriority[] = ['LOW', 'MEDIUM', 'HIGH'];

@Injectable()
export class ClientRequestsService {
  private readonly logger = new Logger(ClientRequestsService.name);

  constructor(
    private readonly repo: ClientRequestsRepository,
    private readonly clients: ClientsService,
    private readonly projects: ProjectsService,
    private readonly integrations: IntegrationsService,
    private readonly jira: JiraService,
    private readonly llm: LLMService,
    private readonly documents: DocumentsService,
    @Inject(TRANSCRIPTION_PROVIDER)
    private readonly transcriptionProvider: ITranscriptionProvider,
  ) {}

  async findByIdOrFail(id: number): Promise<ClientRequest> {
    const r = await this.repo.findById(id);
    if (!r) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Solicitud no encontrada' });
    }
    return r;
  }

  list(params: {
    status?: ClientRequestStatus;
    clientId?: number;
    projectId?: number;
    serviceCategory?: ServiceCategory;
    q?: string;
  }): Promise<ClientRequest[]> {
    return this.repo.list(params);
  }

  async create(userId: number, dto: CreateClientRequestDto): Promise<ClientRequest> {
    if (dto.clientId) await this.clients.findByIdOrFail(dto.clientId);
    if (dto.projectId) await this.projects.findById(dto.projectId);

    return this.repo.create({
      source: dto.source ?? 'NOTE',
      rawText: dto.rawText.trim(),
      rawAudioFilename: dto.rawAudioFilename ?? null,
      capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : new Date(),
      title: dto.title?.trim() || null,
      status: 'INBOX',
      clientId: dto.clientId ?? null,
      projectId: dto.projectId ?? null,
      meetingId: dto.meetingId ?? null,
      serviceCategory: dto.serviceCategory ?? null,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      durationMinutes: dto.durationMinutes ?? null,
      attendedAt: dto.attendedAt ? new Date(dto.attendedAt) : null,
      createdBy: userId,
    });
  }

  async update(id: number, dto: UpdateClientRequestDto): Promise<ClientRequest> {
    await this.findByIdOrFail(id);
    const patch: Partial<ClientRequest> = { ...dto } as Partial<ClientRequest>;
    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  async remove(id: number): Promise<void> {
    const r = await this.findByIdOrFail(id);
    if (r.status === 'SENT') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'No se puede borrar una solicitud ya enviada a Jira. Archivala en su lugar.',
      });
    }
    await this.repo.remove(id);
  }

  // -----------------------------------------------------------------------
  // Estructuración con IA
  // -----------------------------------------------------------------------

  async structureWithAI(id: number): Promise<ClientRequest> {
    const req = await this.findByIdOrFail(id);

    const clientLabel = req.clientId
      ? (await this.clients.findByIdOrFail(req.clientId)).razonSocial
      : '(sin cliente asignado)';
    const projectLabel = req.projectId
      ? (await this.projects.findById(req.projectId)).name
      : '(sin proyecto asignado)';

    const systemPrompt = [
      'Eres un analista técnico que estructura solicitudes de clientes para ser subidas a Jira.',
      'Recibes un texto crudo (WhatsApp, nota, transcripción de voz) y devuelves SOLO un JSON con esta forma:',
      '{',
      '  "requestType": "MEJORA" | "FEATURE" | "AJUSTE" | "BUG",',
      '  "priority": "LOW" | "MEDIUM" | "HIGH",',
      '  "moduleName": string | null,',
      '  "screenName": string | null,',
      '  "flowContext": string | null,',
      '  "title": string,',
      '  "descriptionMd": string,',
      '  "acceptanceCriteria": string[],',
      '  "labels": string[]',
      '}',
      '',
      'Reglas:',
      '- requestType: MEJORA si es usabilidad/UX de algo ya existente; FEATURE si es una capacidad nueva;',
      '  AJUSTE si es un cambio de comportamiento solicitado por el cliente; BUG sólo si algo está roto.',
      '- priority: MEDIUM por defecto. HIGH sólo si hay urgencia explícita o impacto crítico. LOW si es cosmético.',
      '- title: resumen corto (máx 90 caracteres), SIN prefijos entre corchetes — el prefijo se arma después.',
      '- moduleName: módulo funcional (ej: "Venta", "Cobranza"). screenName: pantalla (ej: "Progresivo").',
      '- flowContext: disparador/flujo (ej: "Al ingresar llamada del marcado"). null si no aplica.',
      '- descriptionMd: markdown con secciones "## Contexto" y "## Requerimiento". Cita frases literales del cliente entre comillas cuando convenga.',
      '- acceptanceCriteria: lista verificable (2-5 ítems). Cada uno debe poder marcarse como OK/NO-OK.',
      '- labels: 2-4 labels en kebab-case. Sugerencias: "tipo-<ajuste|mejora|feature|bug>", "modulo-<slug>", "pantalla-<slug>".',
      'Responde únicamente el JSON, sin explicaciones ni bloques de código.',
    ].join('\n');

    const userPrompt = [
      `Cliente: ${clientLabel}`,
      `Proyecto: ${projectLabel}`,
      '',
      'Texto crudo:',
      '"""',
      req.rawText,
      '"""',
    ].join('\n');

    const raw = await this.llm.chat(systemPrompt, [{ role: 'user', content: userPrompt }]);
    const parsed = this.parseStructuredJson(raw);

    const updated = await this.repo.update(id, {
      status: 'STRUCTURED',
      requestType: parsed.requestType,
      priority: parsed.priority,
      moduleName: parsed.moduleName,
      screenName: parsed.screenName,
      flowContext: parsed.flowContext,
      title: parsed.title,
      descriptionMd: parsed.descriptionMd,
      acceptanceCriteria: parsed.acceptanceCriteria,
      labels: parsed.labels,
    });
    return updated!;
  }

  private parseStructuredJson(raw: string): StructuredPayload {
    const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new BadRequestException({
        code: 'LLM_ERROR',
        message: 'La IA devolvió un formato inválido. Intenta de nuevo.',
      });
    }
    const obj = (parsed ?? {}) as Partial<StructuredPayload>;
    const typeValue: ClientRequestType = VALID_TYPES.includes(obj.requestType as ClientRequestType)
      ? (obj.requestType as ClientRequestType)
      : 'AJUSTE';
    const priorityValue: ClientRequestPriority = VALID_PRIORITIES.includes(
      obj.priority as ClientRequestPriority,
    )
      ? (obj.priority as ClientRequestPriority)
      : 'MEDIUM';

    return {
      requestType: typeValue,
      priority: priorityValue,
      moduleName: typeof obj.moduleName === 'string' ? obj.moduleName : null,
      screenName: typeof obj.screenName === 'string' ? obj.screenName : null,
      flowContext: typeof obj.flowContext === 'string' ? obj.flowContext : null,
      title: typeof obj.title === 'string' && obj.title.length > 0 ? obj.title.slice(0, 240) : 'Solicitud sin título',
      descriptionMd: typeof obj.descriptionMd === 'string' ? obj.descriptionMd : '',
      acceptanceCriteria: Array.isArray(obj.acceptanceCriteria)
        ? obj.acceptanceCriteria.filter((x) => typeof x === 'string')
        : [],
      labels: Array.isArray(obj.labels) ? obj.labels.filter((x) => typeof x === 'string') : [],
    };
  }

  // -----------------------------------------------------------------------
  // Push a Jira
  // -----------------------------------------------------------------------

  async pushToJira(id: number): Promise<ClientRequest> {
    const req = await this.findByIdOrFail(id);
    if (req.status === 'SENT' && req.jiraIssueKey) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Ya se envió a Jira como ${req.jiraIssueKey}`,
      });
    }
    if (!req.title || !req.descriptionMd) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Estructura la solicitud antes de enviarla a Jira.',
      });
    }
    if (!req.projectId) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Asigna un proyecto antes de enviar a Jira.',
      });
    }

    const project = await this.projects.findById(req.projectId);
    if (!project.jiraIntegrationId || !project.jiraProjectKey) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: `El proyecto "${project.name}" no tiene Jira vinculado.`,
      });
    }

    const integration = await this.integrations.findByIdOrFail(project.jiraIntegrationId);
    const auth = this.integrations.getJiraAuth(integration);

    const client = req.clientId ? await this.clients.findByIdOrFail(req.clientId) : null;

    // Título con prefijo [<CLIENTE>-<MODULO>]
    const clientCode = client?.jiraCode ?? null;
    const moduleCode = project.jiraCode ?? null;
    const prefix =
      clientCode && moduleCode
        ? `[${clientCode}-${moduleCode}] `
        : clientCode
          ? `[${clientCode}] `
          : moduleCode
            ? `[${moduleCode}] `
            : '';
    const screenPart = req.screenName ? `${req.screenName}: ` : '';
    const summary = `${prefix}${screenPart}${req.title}`.trim().slice(0, 240);

    // Labels auto-inyectadas
    const autoLabels = new Set<string>(req.labels ?? []);
    if (req.requestType) autoLabels.add(`tipo-${req.requestType.toLowerCase()}`);
    if (client) autoLabels.add(`cliente-${this.slug(client.razonSocial)}`);
    if (req.moduleName) autoLabels.add(`modulo-${this.slug(req.moduleName)}`);
    if (req.screenName) autoLabels.add(`pantalla-${this.slug(req.screenName)}`);

    const priorityMap: Record<ClientRequestPriority, 'Low' | 'Medium' | 'High'> = {
      LOW: 'Low',
      MEDIUM: 'Medium',
      HIGH: 'High',
    };

    const descriptionWithFooter = this.buildDescription(req, client?.razonSocial ?? null);

    const result = await this.jira.createSingleIssue(auth, {
      projectKey: project.jiraProjectKey,
      summary,
      descriptionMarkdown: descriptionWithFooter,
      acceptanceCriteria: req.acceptanceCriteria ?? undefined,
      labels: Array.from(autoLabels),
      priority: req.priority ? priorityMap[req.priority] : null,
      preferredType: 'Task',
    });

    const updated = await this.repo.update(id, {
      status: 'SENT',
      title: summary,
      jiraIntegrationId: integration.id,
      jiraProjectKey: project.jiraProjectKey,
      jiraIssueKey: result.key,
      jiraIssueUrl: result.url,
      sentAt: new Date(),
      labels: Array.from(autoLabels),
    });
    return updated!;
  }

  // -----------------------------------------------------------------------
  // Completar solicitud + generar documento de cierre
  // -----------------------------------------------------------------------

  async complete(
    id: number,
    userId: number,
  ): Promise<{ request: ClientRequest; documentId: number | null }> {
    const req = await this.findByIdOrFail(id);
    if (req.status === 'COMPLETED' || req.status === 'ARCHIVED') {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'La solicitud ya está completada o archivada.',
      });
    }

    const client = req.clientId ? await this.clients.findByIdOrFail(req.clientId) : null;
    const project = req.projectId ? await this.projects.findById(req.projectId) : null;

    let documentId: number | null = null;
    if (client) {
      const closureMd = this.buildClosureMarkdown(req, client.razonSocial, project?.name ?? null);
      const titleParts = [req.title ?? 'Solicitud'];
      const docTitle = `Cierre: ${titleParts[0].slice(0, 120)}`;
      try {
        const doc = await this.documents.createDocumentRaw(userId, {
          clientId: client.id,
          projectId: req.projectId ?? undefined,
          title: docTitle,
          type: 'OTHER',
          contentMarkdown: closureMd,
        });
        documentId = doc.id;
      } catch (err) {
        this.logger.warn(`No se pudo generar documento de cierre para request ${id}: ${err}`);
      }
    }

    const updated = await this.repo.update(id, {
      status: 'COMPLETED',
      completedAt: new Date(),
      closureDocumentId: documentId,
    });
    return { request: updated!, documentId };
  }

  private buildClosureMarkdown(
    req: ClientRequest,
    clientName: string,
    projectName: string | null,
  ): string {
    const dateStr = new Date().toLocaleDateString('es-PE', { dateStyle: 'long' });
    const typeLabels: Record<string, string> = {
      MEJORA: 'Mejora', FEATURE: 'Nueva funcionalidad', AJUSTE: 'Ajuste', BUG: 'Bug',
    };
    const priorityLabels: Record<string, string> = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' };

    const rows: string[] = [
      `| Campo | Detalle |`,
      `|---|---|`,
      req.jiraIssueKey ? `| Referencia Jira | ${req.jiraIssueKey} |` : '',
      req.requestType ? `| Tipo | ${typeLabels[req.requestType] ?? req.requestType} |` : '',
      req.priority ? `| Prioridad | ${priorityLabels[req.priority] ?? req.priority} |` : '',
      projectName ? `| Proyecto | ${projectName} |` : '',
      req.moduleName ? `| Módulo | ${req.moduleName} |` : '',
      req.screenName ? `| Pantalla | ${req.screenName} |` : '',
      req.flowContext ? `| Flujo | ${req.flowContext} |` : '',
      req.sentAt ? `| Enviado a Jira | ${new Date(req.sentAt).toLocaleDateString('es-PE')} |` : '',
      `| Fecha de cierre | ${dateStr} |`,
    ].filter((r) => r.length > 0);

    const criteriaBlock =
      req.acceptanceCriteria && req.acceptanceCriteria.length > 0
        ? `## Criterios de aceptación cumplidos\n\n${req.acceptanceCriteria.map((c) => `- ✓ ${c}`).join('\n')}\n\n`
        : '';

    const descBlock = req.descriptionMd ? `## Descripción\n\n${req.descriptionMd}\n\n` : '';

    return [
      `# Notificación de cierre de solicitud`,
      ``,
      `Estimados de **{{cliente_razon_social}}**,`,
      ``,
      `Por medio del presente comunicado, informamos que la siguiente solicitud ha sido atendida y cerrada satisfactoriamente.`,
      ``,
      `## Datos de la solicitud`,
      ``,
      rows.join('\n'),
      ``,
      descBlock,
      criteriaBlock,
      `---`,
      ``,
      `Quedamos a su disposición ante cualquier consulta o comentario.`,
      ``,
      `Atentamente,`,
      ``,
      `**{{emisor_razon_social}}**`,
    ].join('\n');
  }

  private buildDescription(req: ClientRequest, clientName: string | null): string {
    const footer = [
      '',
      '---',
      '*Trazabilidad*',
      clientName ? `- Cliente: ${clientName}` : null,
      req.moduleName ? `- Módulo: ${req.moduleName}` : null,
      req.screenName ? `- Pantalla: ${req.screenName}` : null,
      req.flowContext ? `- Flujo: ${req.flowContext}` : null,
      `- Fuente: ${req.source}`,
      `- Capturado: ${req.capturedAt.toISOString().slice(0, 10)}`,
      '',
      '*Solicitud original*',
      '> ' + req.rawText.split('\n').join('\n> '),
    ]
      .filter((l) => l !== null)
      .join('\n');
    return (req.descriptionMd ?? '') + footer;
  }

  private slug(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  }

  // -----------------------------------------------------------------------
  // Transcripción ad-hoc (para captura por audio)
  // -----------------------------------------------------------------------

  async transcribeAudioBuffer(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ text: string; language: string | null }> {
    if (!buffer?.length) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Archivo de audio vacío' });
    }
    const stream = Readable.from(buffer);
    const result = await this.transcriptionProvider.transcribe(stream, mimeType || 'audio/webm');
    return { text: result.text, language: result.language };
  }
}
