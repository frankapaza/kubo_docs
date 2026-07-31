import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'stream';

import { TicketsRepository } from './tickets.repository';
import { TicketTransitionsService } from './ticket-transitions.service';
import { SlaService } from './sla.service';
import {
  Ticket,
  TicketRequestType,
  ServiceCategory,
  TICKET_REQUEST_TYPES,
  SERVICE_CATEGORIES,
} from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import {
  TicketImpact,
  TicketUrgency,
  TicketPriority,
  TICKET_IMPACTS,
  TICKET_URGENCIES,
  derivePriority,
} from './domain/ticket-priority';

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

interface TriagePayload {
  requestType: TicketRequestType;
  serviceCategory: ServiceCategory;
  impact: TicketImpact;
  urgency: TicketUrgency;
  moduleName: string | null;
  screenName: string | null;
  flowContext: string | null;
  subject: string;
  descriptionMd: string;
  acceptanceCriteria: string[];
  labels: string[];
  confidence: number;
}

/**
 * Capacidades de IA/integraciones sobre un ticket, portadas de
 * `client-requests.service.ts` (Tarea 13). El módulo viejo sigue en pie
 * hasta la Tarea 14: no se toca desde aquí.
 */
@Injectable()
export class TicketAIService {
  constructor(
    private readonly repo: TicketsRepository,
    private readonly transitions: TicketTransitionsService,
    private readonly sla: SlaService,
    private readonly clients: ClientsService,
    private readonly projects: ProjectsService,
    private readonly integrations: IntegrationsService,
    private readonly jira: JiraService,
    private readonly llm: LLMService,
    private readonly documents: DocumentsService,
    @Inject(TRANSCRIPTION_PROVIDER)
    private readonly transcriptionProvider: ITranscriptionProvider,
  ) {}

  private async findOrFail(id: number): Promise<Ticket> {
    const t = await this.repo.findById(id);
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
    return t;
  }

  // -----------------------------------------------------------------------
  // Triaje con IA
  // -----------------------------------------------------------------------

  /**
   * Reemplaza a `structureWithAI` del módulo viejo. Devuelve además `impact`
   * y `urgency` (para alimentar la matriz de prioridad en vez de un
   * `LOW/MEDIUM/HIGH` fijo) y deja el ticket en `TRIAJE`.
   *
   * El patch de campos y el evento `TRIAGED` tienen que confirmarse juntos:
   * si el evento fallara fuera de una transacción, el ticket quedaría
   * reclasificado sin rastro en el timeline. Mismo idioma que
   * `TicketAssignmentService.assign()`: se escribe a través del
   * `EntityManager` de la transacción (`manager.getRepository`), no de
   * `this.repo`.
   *
   * La transición de estado (cuando aplica) se delega a
   * `TicketTransitionsService.transition()`, que abre su propia transacción:
   * se llama después de que la de arriba confirme, nunca anidada dentro de
   * ella. No hace falta `assertTransition` aquí: la guarda de este método
   * (`ticket.status === 'NUEVO'`) coincide exactamente con la precondición
   * de `transition()` a `TRIAJE` — es una transición estática siempre legal
   * desde `NUEVO` (ver `domain/ticket-state-machine`), a diferencia de
   * `take()`/`escalate()`, donde la guarda es más laxa que la que exige el
   * estado destino.
   */
  async triage(id: number, actorUserId: number): Promise<Ticket> {
    const ticket = await this.findOrFail(id);

    const clientLabel = ticket.clientId
      ? (await this.clients.findByIdOrFail(ticket.clientId)).razonSocial
      : '(sin cliente asignado)';

    const systemPrompt = [
      'Eres el triaje de una mesa de servicio. Recibes el texto crudo de una',
      'incidencia (correo, WhatsApp, nota o transcripción) y devuelves SOLO un JSON:',
      '{',
      '  "requestType": "INCIDENCIA" | "BUG" | "MEJORA" | "FEATURE" | "AJUSTE",',
      '  "serviceCategory": "SOFTWARE" | "SOPORTE" | "CAPACITACION" | "CONSULTA" | "ASESORIA" | "VISITA_SITIO" | "OTRO",',
      '  "impact": "ALTO" | "MEDIO" | "BAJO",',
      '  "urgency": "ALTA" | "MEDIA" | "BAJA",',
      '  "moduleName": string | null,',
      '  "screenName": string | null,',
      '  "flowContext": string | null,',
      '  "subject": string,',
      '  "descriptionMd": string,',
      '  "acceptanceCriteria": string[],',
      '  "labels": string[],',
      '  "confidence": number',
      '}',
      '',
      'Reglas:',
      '- impact: ALTO si el servicio está caído o afecta a varias sedes/usuarios;',
      '  MEDIO si degrada el trabajo pero hay alternativa; BAJO si es cosmético o aislado.',
      '- urgency: ALTA si bloquea la operación ahora; MEDIA si se puede esperar horas;',
      '  BAJA si puede esperar días. NO devuelvas prioridad: se deriva de impacto x urgencia.',
      '- requestType: INCIDENCIA si algo dejó de funcionar; BUG si es un defecto reproducible;',
      '  MEJORA/FEATURE/AJUSTE si es trabajo de desarrollo solicitado.',
      '- subject: resumen corto (máx 90 caracteres), sin prefijos entre corchetes.',
      '- descriptionMd: markdown con "## Contexto" y "## Detalle". Cita frases del cliente.',
      '- confidence: 0 a 100, tu confianza en la clasificación.',
      'Responde únicamente el JSON, sin explicaciones ni bloques de código.',
    ].join('\n');

    const userPrompt = [
      `Cliente: ${clientLabel}`,
      '',
      'Texto crudo:',
      '"""',
      ticket.rawText,
      '"""',
    ].join('\n');

    const raw = await this.llm.chat(systemPrompt, [{ role: 'user', content: userPrompt }]);
    const parsed = this.parseTriageJson(raw);

    const priority = derivePriority(parsed.impact, parsed.urgency);
    const slaInit = await this.sla.initForTicket({
      clientId: ticket.clientId,
      createdAt: ticket.createdAt,
      priority,
    });

    const patch: Partial<Ticket> = {
      requestType: parsed.requestType,
      serviceCategory: parsed.serviceCategory,
      impact: parsed.impact,
      urgency: parsed.urgency,
      moduleName: parsed.moduleName,
      screenName: parsed.screenName,
      flowContext: parsed.flowContext,
      subject: parsed.subject,
      descriptionMd: parsed.descriptionMd,
      acceptanceCriteria: parsed.acceptanceCriteria,
      labels: parsed.labels,
    };
    // El triaje no pisa una prioridad que un humano ya fijó a mano.
    if (ticket.priorityOverridden !== 1) {
      patch.priority = priority;
      patch.slaPolicyId = slaInit.slaPolicyId;
      patch.slaResponseDueAt = slaInit.slaResponseDueAt;
      patch.slaResolutionDueAt = slaInit.slaResolutionDueAt;
    }

    const updated = await this.repo.runInTransaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      const eventRepo = manager.getRepository(TicketEvent);

      await ticketRepo.update(id, patch);

      await eventRepo.save(
        eventRepo.create({
          ticketId: id,
          type: 'TRIAGED',
          actorUserId,
          payload: {
            confidence: parsed.confidence,
            priority,
            impact: parsed.impact,
            urgency: parsed.urgency,
          },
        }),
      );

      return (await ticketRepo.findOneBy({ id }))!;
    });

    // Solo mueve el estado si el ticket seguía recién creado.
    if (ticket.status === 'NUEVO') {
      return this.transitions.transition({ ticketId: id, actorUserId, toStatus: 'TRIAJE' });
    }
    return updated;
  }

  private parseTriageJson(raw: string): TriagePayload {
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
    const obj = (parsed ?? {}) as Partial<TriagePayload>;

    const requestType: TicketRequestType = TICKET_REQUEST_TYPES.includes(
      obj.requestType as TicketRequestType,
    )
      ? (obj.requestType as TicketRequestType)
      : 'INCIDENCIA';
    const serviceCategory: ServiceCategory = SERVICE_CATEGORIES.includes(
      obj.serviceCategory as ServiceCategory,
    )
      ? (obj.serviceCategory as ServiceCategory)
      : 'SOPORTE';
    const impact: TicketImpact = TICKET_IMPACTS.includes(obj.impact as TicketImpact)
      ? (obj.impact as TicketImpact)
      : 'MEDIO';
    const urgency: TicketUrgency = TICKET_URGENCIES.includes(obj.urgency as TicketUrgency)
      ? (obj.urgency as TicketUrgency)
      : 'MEDIA';
    const confidence =
      typeof obj.confidence === 'number' && Number.isFinite(obj.confidence) ? obj.confidence : 0;

    return {
      requestType,
      serviceCategory,
      impact,
      urgency,
      moduleName: typeof obj.moduleName === 'string' ? obj.moduleName : null,
      screenName: typeof obj.screenName === 'string' ? obj.screenName : null,
      flowContext: typeof obj.flowContext === 'string' ? obj.flowContext : null,
      subject:
        typeof obj.subject === 'string' && obj.subject.length > 0
          ? obj.subject.slice(0, 240)
          : 'Ticket sin asunto',
      descriptionMd: typeof obj.descriptionMd === 'string' ? obj.descriptionMd : '',
      acceptanceCriteria: Array.isArray(obj.acceptanceCriteria)
        ? obj.acceptanceCriteria.filter((x) => typeof x === 'string')
        : [],
      labels: Array.isArray(obj.labels) ? obj.labels.filter((x) => typeof x === 'string') : [],
      confidence,
    };
  }

  // -----------------------------------------------------------------------
  // Push a Jira
  // -----------------------------------------------------------------------

  /**
   * El patch de campos (resumen final, datos de Jira) y el evento de
   * timeline tienen que confirmarse juntos, mismo idioma que `triage()` y
   * que `TicketAssignmentService.overridePriority()`.
   */
  async pushToJira(id: number, actorUserId: number): Promise<Ticket> {
    const ticket = await this.findOrFail(id);
    if (ticket.jiraIssueKey) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Ya se envió a Jira como ${ticket.jiraIssueKey}`,
      });
    }
    if (!ticket.subject || !ticket.descriptionMd) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Realiza el triaje del ticket antes de enviarlo a Jira.',
      });
    }
    if (!ticket.projectId) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Asigna un proyecto antes de enviar a Jira.',
      });
    }

    const project = await this.projects.findById(ticket.projectId);
    if (!project.jiraIntegrationId || !project.jiraProjectKey) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: `El proyecto "${project.name}" no tiene Jira vinculado.`,
      });
    }

    const integration = await this.integrations.findByIdOrFail(project.jiraIntegrationId);
    const auth = this.integrations.getJiraAuth(integration);

    const client = ticket.clientId ? await this.clients.findByIdOrFail(ticket.clientId) : null;

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
    const screenPart = ticket.screenName ? `${ticket.screenName}: ` : '';
    const summary = `${prefix}${screenPart}${ticket.subject}`.trim().slice(0, 240);

    // Labels auto-inyectadas
    const autoLabels = new Set<string>(ticket.labels ?? []);
    if (ticket.requestType) autoLabels.add(`tipo-${ticket.requestType.toLowerCase()}`);
    if (client) autoLabels.add(`cliente-${this.slug(client.razonSocial)}`);
    if (ticket.moduleName) autoLabels.add(`modulo-${this.slug(ticket.moduleName)}`);
    if (ticket.screenName) autoLabels.add(`pantalla-${this.slug(ticket.screenName)}`);

    const priorityMap: Record<TicketPriority, 'Highest' | 'High' | 'Medium' | 'Low'> = {
      P1: 'Highest',
      P2: 'High',
      P3: 'Medium',
      P4: 'Low',
    };

    const descriptionWithFooter = this.buildDescription(ticket, client?.razonSocial ?? null);

    const result = await this.jira.createSingleIssue(auth, {
      projectKey: project.jiraProjectKey,
      summary,
      descriptionMarkdown: descriptionWithFooter,
      acceptanceCriteria: ticket.acceptanceCriteria ?? undefined,
      labels: Array.from(autoLabels),
      priority: ticket.priority ? priorityMap[ticket.priority] : null,
      preferredType: 'Task',
    });

    return this.repo.runInTransaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      const eventRepo = manager.getRepository(TicketEvent);

      await ticketRepo.update(id, {
        subject: summary,
        jiraIntegrationId: integration.id,
        jiraProjectKey: project.jiraProjectKey,
        jiraIssueKey: result.key,
        jiraIssueUrl: result.url,
        sentAt: new Date(),
        labels: Array.from(autoLabels),
      });

      await eventRepo.save(
        eventRepo.create({
          ticketId: id,
          type: 'COMMENT',
          actorUserId,
          payload: { action: 'JIRA_PUSHED', jiraIssueKey: result.key, jiraIssueUrl: result.url },
        }),
      );

      return (await ticketRepo.findOneBy({ id }))!;
    });
  }

  private buildDescription(ticket: Ticket, clientName: string | null): string {
    const footer = [
      '',
      '---',
      '*Trazabilidad*',
      clientName ? `- Cliente: ${clientName}` : null,
      ticket.moduleName ? `- Módulo: ${ticket.moduleName}` : null,
      ticket.screenName ? `- Pantalla: ${ticket.screenName}` : null,
      ticket.flowContext ? `- Flujo: ${ticket.flowContext}` : null,
      `- Fuente: ${ticket.origin}`,
      `- Capturado: ${ticket.capturedAt.toISOString().slice(0, 10)}`,
      '',
      '*Solicitud original*',
      '> ' + ticket.rawText.split('\n').join('\n> '),
    ]
      .filter((l) => l !== null)
      .join('\n');
    return (ticket.descriptionMd ?? '') + footer;
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
  // Documento de cierre
  // -----------------------------------------------------------------------

  /**
   * Genera el documento de cierre (markdown) y lo enlaza al ticket. Mismo
   * idioma de escritura atómica que el resto del servicio.
   */
  async generateClosureDocument(
    id: number,
    userId: number,
  ): Promise<{ ticket: Ticket; documentId: number }> {
    const ticket = await this.findOrFail(id);
    if (ticket.closureDocumentId) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Ya se generó un documento de cierre para este ticket.',
      });
    }
    if (!ticket.clientId) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'El ticket no tiene cliente asignado; no se puede generar el documento de cierre.',
      });
    }

    const client = await this.clients.findByIdOrFail(ticket.clientId);
    const project = ticket.projectId ? await this.projects.findById(ticket.projectId) : null;

    const closureMd = this.buildClosureMarkdown(ticket, client.razonSocial, project?.name ?? null);
    const docTitle = `Cierre: ${(ticket.subject ?? 'Ticket').slice(0, 120)}`;

    const doc = await this.documents.createDocumentRaw(userId, {
      clientId: client.id,
      projectId: ticket.projectId ?? undefined,
      title: docTitle,
      type: 'OTHER',
      contentMarkdown: closureMd,
    });

    const updated = await this.repo.runInTransaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      const eventRepo = manager.getRepository(TicketEvent);

      await ticketRepo.update(id, { closureDocumentId: doc.id });

      await eventRepo.save(
        eventRepo.create({
          ticketId: id,
          type: 'COMMENT',
          actorUserId: userId,
          payload: { action: 'CLOSURE_DOCUMENT_GENERATED', documentId: doc.id },
        }),
      );

      return (await ticketRepo.findOneBy({ id }))!;
    });

    return { ticket: updated, documentId: doc.id };
  }

  private buildClosureMarkdown(
    ticket: Ticket,
    clientName: string,
    projectName: string | null,
  ): string {
    const dateStr = new Date().toLocaleDateString('es-PE', { dateStyle: 'long' });
    const typeLabels: Record<string, string> = {
      INCIDENCIA: 'Incidencia',
      BUG: 'Bug',
      MEJORA: 'Mejora',
      FEATURE: 'Nueva funcionalidad',
      AJUSTE: 'Ajuste',
    };
    const priorityLabels: Record<string, string> = {
      P1: 'P1 - Crítica',
      P2: 'P2 - Alta',
      P3: 'P3 - Media',
      P4: 'P4 - Baja',
    };

    const rows: string[] = [
      `| Campo | Detalle |`,
      `|---|---|`,
      ticket.jiraIssueKey ? `| Referencia Jira | ${ticket.jiraIssueKey} |` : '',
      ticket.requestType ? `| Tipo | ${typeLabels[ticket.requestType] ?? ticket.requestType} |` : '',
      ticket.priority ? `| Prioridad | ${priorityLabels[ticket.priority] ?? ticket.priority} |` : '',
      projectName ? `| Proyecto | ${projectName} |` : '',
      ticket.moduleName ? `| Módulo | ${ticket.moduleName} |` : '',
      ticket.screenName ? `| Pantalla | ${ticket.screenName} |` : '',
      ticket.flowContext ? `| Flujo | ${ticket.flowContext} |` : '',
      ticket.sentAt ? `| Enviado a Jira | ${new Date(ticket.sentAt).toLocaleDateString('es-PE')} |` : '',
      `| Fecha de cierre | ${dateStr} |`,
    ].filter((r) => r.length > 0);

    const criteriaBlock =
      ticket.acceptanceCriteria && ticket.acceptanceCriteria.length > 0
        ? `## Criterios de aceptación cumplidos\n\n${ticket.acceptanceCriteria.map((c) => `- ✓ ${c}`).join('\n')}\n\n`
        : '';

    const descBlock = ticket.descriptionMd ? `## Descripción\n\n${ticket.descriptionMd}\n\n` : '';

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
