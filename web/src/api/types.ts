export type UserRole =
  | 'ADMIN'
  | 'PRODUCT_OWNER'
  | 'SCRUM_MASTER'
  | 'DEVELOPER'
  | 'STAKEHOLDER';

export interface User {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
}

export type ClientStatus = 'PROSPECT' | 'CLIENT' | 'FORMER_CLIENT';

export const CLIENT_STATUSES: ClientStatus[] = ['PROSPECT', 'CLIENT', 'FORMER_CLIENT'];

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  PROSPECT: 'Prospecto',
  CLIENT: 'Cliente activo',
  FORMER_CLIENT: 'Ex cliente',
};

export interface Client {
  id: number;
  razonSocial: string;
  ruc: string | null;
  jiraCode: string | null;
  legalRepName: string | null;
  legalRepDoc: string | null;
  address: string | null;
  phone: string | null;
  contactEmail: string | null;
  status: ClientStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: number;
  code: string;
  jiraCode: string | null;
  clientId: number | null;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  jiraIntegrationId: number | null;
  jiraProjectKey: string | null;
}

export type ServiceCategory =
  | 'SOFTWARE'
  | 'SOPORTE'
  | 'CAPACITACION'
  | 'CONSULTA'
  | 'ASESORIA'
  | 'VISITA_SITIO'
  | 'OTRO';

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  'SOFTWARE',
  'SOPORTE',
  'CAPACITACION',
  'CONSULTA',
  'ASESORIA',
  'VISITA_SITIO',
  'OTRO',
];

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  SOFTWARE: 'Atención de sistemas',
  SOPORTE: 'Atención de soporte',
  CAPACITACION: 'Capacitación',
  CONSULTA: 'Consultas',
  ASESORIA: 'Apoyo en asesoría',
  VISITA_SITIO: 'Visita en sitio',
  OTRO: 'Otro',
};

export interface MonthlyTicketRow {
  id: number;
  title: string | null;
  rawText: string;
  requestType: string | null;
  status: string;
  priority: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  attendedAt: string | null;
  capturedAt: string;
  durationMinutes: number | null;
  createdAt: string;
}

export interface MonthlyAttentionCategoryGroup {
  category: ServiceCategory | 'SIN_CATEGORIA';
  label: string;
  count: number;
  completedCount: number;
  totalMinutes: number;
  tickets: MonthlyTicketRow[];
}

export interface MonthlyAttentionReport {
  clientId: number;
  clientName: string;
  range: { from: string; to: string };
  totals: {
    total: number;
    completed: number;
    pending: number;
    totalMinutes: number;
  };
  byCategory: MonthlyAttentionCategoryGroup[];
}

export type MeetingStatus =
  | 'SCHEDULED' | 'IN_PROGRESS' | 'RECORDED'
  | 'TRANSCRIBING' | 'TRANSCRIBED'
  | 'ACTA_DRAFT' | 'ACTA_APPROVED' | 'CLOSED';

export type MeetingType =
  | 'GENERIC'
  | 'DAILY'
  | 'RETROSPECTIVE'
  | 'SPRINT_PLANNING'
  | 'SPRINT_REVIEW'
  | 'POSTMORTEM'
  | 'DISCOVERY';

export const MEETING_TYPES: MeetingType[] = [
  'GENERIC',
  'DAILY',
  'RETROSPECTIVE',
  'SPRINT_PLANNING',
  'SPRINT_REVIEW',
  'POSTMORTEM',
  'DISCOVERY',
];

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  GENERIC: 'Reunión general',
  DAILY: 'Daily standup',
  RETROSPECTIVE: 'Retrospectiva',
  SPRINT_PLANNING: 'Sprint Planning',
  SPRINT_REVIEW: 'Sprint Review',
  POSTMORTEM: 'Postmortem',
  DISCOVERY: 'Discovery / Entrevista',
};

export const MEETING_TYPE_DESCRIPTIONS: Record<MeetingType, string> = {
  GENERIC: 'Acta clásica con resumen, acuerdos y tareas',
  DAILY: 'Extrae updates por persona + impedimentos',
  RETROSPECTIVE: 'Clasifica en Start / Stop / Continue + action items',
  SPRINT_PLANNING: 'Sprint goal + historias seleccionadas + commitment',
  SPRINT_REVIEW: 'Demos + feedback de stakeholders + decisiones',
  POSTMORTEM: 'Timeline + 5 whys + root cause + action items',
  DISCOVERY: 'Insights + hipótesis validadas + preguntas abiertas',
};

export interface MeetingTypeGuide {
  example: string;
  sections: string[];
}

export const MEETING_TYPE_GUIDES: Record<MeetingType, MeetingTypeGuide> = {
  GENERIC: {
    example:
      'Reunión entre el cliente y el equipo para revisar el estado del proyecto, resolver dudas y cerrar acuerdos puntuales. No sigue una ceremonia definida.',
    sections: [
      'Contexto y objetivo de la reunión',
      'Temas tratados (resumen por punto)',
      'Acuerdos alcanzados',
      'Tareas y compromisos (responsable + fecha)',
      'Próximos pasos',
    ],
  },
  DAILY: {
    example:
      'Reunión diaria de ~15 min. Cada integrante cuenta en qué avanzó, qué hará hoy y qué lo está bloqueando. Los bloqueos no se resuelven en la misma daily.',
    sections: [
      'Fecha y sprint activo',
      'Por persona: qué hice ayer / qué haré hoy / impedimentos',
      'Impedimentos a escalar (quién los destraba)',
      'Riesgos detectados para el sprint',
    ],
  },
  RETROSPECTIVE: {
    example:
      'Cierre de sprint. El equipo reflexiona sobre cómo trabajó (no qué construyó) para identificar qué mejorar en el próximo sprint.',
    sections: [
      'Start: qué empezar a hacer',
      'Stop: qué dejar de hacer',
      'Continue: qué mantener',
      'Action items acordados (responsable + fecha)',
    ],
  },
  SPRINT_PLANNING: {
    example:
      'Inicio de sprint. El equipo decide qué historias del backlog entran al sprint y se compromete con un objetivo medible.',
    sections: [
      'Sprint goal (objetivo del sprint)',
      'Historias / tickets seleccionados con estimación',
      'Capacidad del equipo y commitment',
      'Dependencias y riesgos identificados',
    ],
  },
  SPRINT_REVIEW: {
    example:
      'Demo al final del sprint. Se muestra lo construido a los stakeholders y se recoge feedback para ajustar el rumbo del producto.',
    sections: [
      'Historias completadas (demo)',
      'Historias no completadas y motivo',
      'Feedback de stakeholders',
      'Decisiones sobre el backlog y cambios de prioridad',
    ],
  },
  POSTMORTEM: {
    example:
      'Análisis después de un incidente en producción. No busca culpables: busca entender la causa raíz y prevenir que se repita.',
    sections: [
      'Resumen del incidente (impacto y duración)',
      'Timeline de los hechos (hora + evento)',
      '5 whys / análisis de causa raíz',
      'Causa raíz identificada',
      'Action items preventivos (responsable + fecha)',
    ],
  },
  DISCOVERY: {
    example:
      'Entrevista con un usuario, cliente o stakeholder para entender un problema antes de construir solución. Foco en escuchar, no en vender.',
    sections: [
      'Contexto del entrevistado (rol, empresa)',
      'Preguntas planteadas y respuestas clave',
      'Insights / dolores detectados',
      'Hipótesis validadas o descartadas',
      'Preguntas abiertas para la siguiente sesión',
    ],
  },
};

export interface Meeting {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  location: string | null;
  status: MeetingStatus;
  meetingType: MeetingType;
}

export interface Transcription {
  id: number;
  audioFileId: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  contentText: string | null;
  language: string | null;
  errorMessage: string | null;
}

export type AudioDeletedReason =
  | 'NEVER_STORE'
  | 'AFTER_APPROVAL'
  | 'AFTER_DAYS'
  | 'MANUAL';

export interface AudioFile {
  id: number;
  meetingId: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  source: 'WEB' | 'MOBILE';
  createdAt: string;
  deletedAt: string | null;
  deletedReason: AudioDeletedReason | null;
}

export interface Acta {
  id: number;
  meetingId: number;
  status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'EXPORTED';
  contentMarkdown: string;
  version: number;
  exportedPdfKey: string | null;
}

export type ProjectMemberRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface ProjectMember {
  id: number;
  projectId: number;
  userId: number;
  roleInProject: ProjectMemberRole;
  fullName: string;
  email: string;
  globalRole: UserRole;
}

export type ConformityStatus = 'PENDING' | 'SIGNED' | 'REFUSED' | 'ABSENT_EARLY' | 'ABSENT';
export type SignatoryKind = 'INTERNAL' | 'EXTERNAL';

export const CONFORMITY_STATUSES: ConformityStatus[] = [
  'PENDING', 'SIGNED', 'REFUSED', 'ABSENT_EARLY', 'ABSENT',
];
export const CONFORMITY_STATUS_LABELS: Record<ConformityStatus, string> = {
  PENDING: 'Pendiente',
  SIGNED: 'Firmó',
  REFUSED: 'No quiso firmar',
  ABSENT_EARLY: 'Asistió y se ausentó',
  ABSENT: 'No asistió',
};

export interface DocumentSignatory {
  id: number;
  documentId: number;
  userId: number | null;
  kind: SignatoryKind;
  fullName: string;
  documentNumber: string | null;
  email: string | null;
  role: string | null;
  conformityStatus: ConformityStatus;
  notes: string | null;
  signatureToken: string | null;
  tokenExpiresAt: string | null;
  signedAt: string | null;
  signedIp: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Participant {
  id: number;
  meetingId: number;
  userId: number | null;
  fullName: string;
  documentNumber: string | null;
  email: string | null;
  role: string | null;
  attended: number;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BacklogTask {
  title: string;
  assignee: string | null;
}

export interface BacklogStory {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: 'Alta' | 'Media' | 'Baja';
  storyPoints: number | null;
  assignee: string | null;
  tasks: BacklogTask[];
}

export interface BacklogEpic {
  title: string;
  description: string;
  stories: BacklogStory[];
}

export interface BacklogResult {
  epics: BacklogEpic[];
}

export type DocumentType =
  | 'CONTRACT'
  | 'QUOTE'
  | 'NDA'
  | 'SOW'
  | 'TDR'
  | 'ADDENDUM'
  | 'OTHER';

export const DOCUMENT_TYPES: DocumentType[] = [
  'CONTRACT',
  'QUOTE',
  'NDA',
  'SOW',
  'TDR',
  'ADDENDUM',
  'OTHER',
];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  CONTRACT: 'Contrato',
  QUOTE: 'Cotización',
  NDA: 'NDA',
  SOW: 'SOW',
  TDR: 'TDR',
  ADDENDUM: 'Addendum',
  OTHER: 'Otro',
};

export type CommercialDocumentStatus =
  | 'DRAFT'
  | 'SENT'
  | 'SIGNED'
  | 'EXPIRED'
  | 'CANCELLED';

export const COMMERCIAL_DOCUMENT_STATUS_LABELS: Record<CommercialDocumentStatus, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviado',
  SIGNED: 'Firmado',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
};

export interface TemplateVariable {
  key: string;
  label: string;
  type: 'text' | 'longtext' | 'number' | 'date' | 'email';
  source: 'client' | 'workspace' | 'manual' | 'auto' | 'ai';
  required: boolean;
  defaultValue?: string | number;
}

export interface DocumentTemplate {
  id: number;
  name: string;
  type: DocumentType;
  description: string | null;
  contentMarkdown: string;
  variablesSchema: { variables: TemplateVariable[] };
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommercialDocument {
  id: number;
  clientId: number;
  templateId: number | null;
  meetingId: number | null;
  projectId: number | null;
  title: string;
  type: DocumentType;
  status: CommercialDocumentStatus;
  contentMarkdown: string;
  variablesValues: Record<string, string | number | null> | null;
  pdfKey: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Ticket domain types
export type TicketStatus =
  | 'NUEVO' | 'TRIAJE' | 'ASIGNADO' | 'EN_ATENCION'
  | 'ESPERA_CLIENTE' | 'DERIVADO' | 'RESUELTO' | 'CERRADO';

export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type TicketImpact = 'ALTO' | 'MEDIO' | 'BAJO';
export type TicketUrgency = 'ALTA' | 'MEDIA' | 'BAJA';
export type AgentLevel = 'N1' | 'N2' | 'N3';

export type TicketOrigin =
  | 'EMAIL' | 'WHATSAPP_TEXT' | 'WHATSAPP_AUDIO' | 'VOICE_LIVE'
  | 'MEETING' | 'NOTE' | 'PORTAL';

export type TicketRequestType = 'INCIDENCIA' | 'BUG' | 'MEJORA' | 'FEATURE' | 'AJUSTE';

export type TicketEventType =
  | 'CREATED' | 'TRIAGED' | 'ASSIGNED' | 'TAKEN' | 'STATUS_CHANGED'
  | 'ESCALATED' | 'COMMENT' | 'RESOLVED' | 'CLOSED' | 'REOPENED'
  | 'SLA_AT_RISK' | 'PRIORITY_OVERRIDDEN';

export interface Ticket {
  id: number;
  code: string | null;
  clientId: number | null;
  projectId: number | null;
  systemId: number | null;
  origin: TicketOrigin;
  requestType: TicketRequestType | null;
  serviceCategory: ServiceCategory | null;
  subject: string | null;
  rawText: string;
  descriptionMd: string | null;
  impact: TicketImpact | null;
  urgency: TicketUrgency | null;
  priority: TicketPriority;
  priorityOverridden: number;
  status: TicketStatus;
  assigneeUserId: number | null;
  escalationLevel: AgentLevel | null;
  slaResponseDueAt: string | null;
  slaResolutionDueAt: string | null;
  firstResponseAt: string | null;
  pausedAt: string | null;
  slaAtRisk: number;
  resolvedAt: string | null;
  closedAt: string | null;
  resolutionMd: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  jiraIssueKey: string | null;
  jiraIssueUrl: string | null;
  createdAt: string;
  // Derivados que calcula el backend (TicketsService.decorate)
  slaLabel: string;
  slaPct: number | null;
  slaOverdue: boolean;
}

export interface TicketEvent {
  id: number;
  ticketId: number;
  type: TicketEventType;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  actorUserId: number | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface TicketDetail {
  ticket: Ticket;
  timeline: TicketEvent[];
}

export interface ClientSystem {
  id: number;
  clientId: number;
  name: string;
  isActive: number;
}

export interface SupportAgent {
  id: number;
  userId: number;
  level: AgentLevel;
  specialties: ServiceCategory[] | null;
  isActive: number;
}

export interface SupportAgentView extends SupportAgent {
  fullName: string;
  email: string;
  openTickets: number;
}

export type WorkItemStatus =
  | 'PENDIENTE' | 'EN_PROCESO' | 'PRUEBAS' | 'CERRADO' | 'BLOQUEADO' | 'CANCELADO';

export type WorkItemPriority = 'ALTA' | 'MEDIA' | 'BAJA';

export type WorkItemEventType =
  | 'CREATED' | 'MOVED' | 'ASSIGNED' | 'COMMENT' | 'BLOCKED' | 'UNBLOCKED'
  | 'CLOSED' | 'REOPENED' | 'CANCELLED' | 'PRIORITY_CHANGED';

export interface WorkItem {
  id: number;
  code: string | null;
  clientId: number;
  projectId: number | null;
  title: string;
  descriptionMd: string | null;
  acceptanceCriteria: string[] | null;
  labels: string[] | null;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assigneeUserId: number | null;
  boardOrder: number;
  dueDate: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface WorkItemEvent {
  id: number;
  workItemId: number;
  type: WorkItemEventType;
  fromStatus: WorkItemStatus | null;
  toStatus: WorkItemStatus | null;
  actorUserId: number | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface WorkItemDetail {
  workItem: WorkItem;
  timeline: WorkItemEvent[];
}
