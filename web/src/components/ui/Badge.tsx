import { ReactNode } from 'react';

type Tone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'purple';

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  primary: 'bg-kubo-primary-light text-kubo-primary-dark border-indigo-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
};

export function Badge({
  tone = 'neutral',
  children,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${tones[tone]}`}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const meetingTones: Record<string, Tone> = {
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',
  RECORDED: 'primary',
  TRANSCRIBING: 'warning',
  TRANSCRIBED: 'purple',
  ACTA_DRAFT: 'purple',
  ACTA_APPROVED: 'success',
  CLOSED: 'neutral',
};

const meetingLabels: Record<string, string> = {
  SCHEDULED: 'Agendada',
  IN_PROGRESS: 'En curso',
  RECORDED: 'Grabada',
  TRANSCRIBING: 'Transcribiendo',
  TRANSCRIBED: 'Transcrita',
  ACTA_DRAFT: 'Acta en borrador',
  ACTA_APPROVED: 'Acta aprobada',
  CLOSED: 'Cerrada',
};

export function MeetingStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={meetingTones[status] ?? 'neutral'} dot>
      {meetingLabels[status] ?? status}
    </Badge>
  );
}

const actaTones: Record<string, Tone> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'warning',
  APPROVED: 'success',
  EXPORTED: 'primary',
};

const actaLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  APPROVED: 'Aprobada',
  EXPORTED: 'Exportada',
};

export function ActaStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={actaTones[status] ?? 'neutral'} dot>
      {actaLabels[status] ?? status}
    </Badge>
  );
}

const transcriptionTones: Record<string, Tone> = {
  PENDING: 'info',
  PROCESSING: 'warning',
  COMPLETED: 'success',
  FAILED: 'danger',
};

const transcriptionLabels: Record<string, string> = {
  PENDING: 'En cola',
  PROCESSING: 'Procesando',
  COMPLETED: 'Completada',
  FAILED: 'Error',
};

export function TranscriptionStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={transcriptionTones[status] ?? 'neutral'} dot>
      {transcriptionLabels[status] ?? status}
    </Badge>
  );
}

const roleTones: Record<string, Tone> = {
  ADMIN: 'danger',
  PRODUCT_OWNER: 'primary',
  SCRUM_MASTER: 'purple',
  DEVELOPER: 'info',
  STAKEHOLDER: 'neutral',
};

export const roleLabels: Record<string, string> = {
  ADMIN: 'Admin',
  PRODUCT_OWNER: 'Product Owner',
  SCRUM_MASTER: 'Scrum Master',
  DEVELOPER: 'Developer',
  STAKEHOLDER: 'Stakeholder',
};

export function RoleBadge({ role }: { role: string }) {
  return (
    <Badge tone={roleTones[role] ?? 'neutral'}>
      {roleLabels[role] ?? role}
    </Badge>
  );
}

const meetingTypeTones: Record<string, Tone> = {
  GENERIC: 'neutral',
  DAILY: 'info',
  RETROSPECTIVE: 'purple',
  SPRINT_PLANNING: 'primary',
  SPRINT_REVIEW: 'success',
  POSTMORTEM: 'danger',
  DISCOVERY: 'warning',
};

const meetingTypeLabels: Record<string, string> = {
  GENERIC: 'General',
  DAILY: 'Daily',
  RETROSPECTIVE: 'Retro',
  SPRINT_PLANNING: 'Planning',
  SPRINT_REVIEW: 'Review',
  POSTMORTEM: 'Postmortem',
  DISCOVERY: 'Discovery',
};

const meetingTypeIcons: Record<string, string> = {
  GENERIC: '📝',
  DAILY: '☀️',
  RETROSPECTIVE: '🔄',
  SPRINT_PLANNING: '🎯',
  SPRINT_REVIEW: '👀',
  POSTMORTEM: '🚨',
  DISCOVERY: '🔍',
};

export function MeetingTypeBadge({ type }: { type: string }) {
  if (!type || type === 'GENERIC') return null;
  return (
    <Badge tone={meetingTypeTones[type] ?? 'neutral'}>
      <span className="text-[10px]">{meetingTypeIcons[type] ?? ''}</span>
      {meetingTypeLabels[type] ?? type}
    </Badge>
  );
}

const requestStatusTones: Record<string, Tone> = {
  INBOX: 'info',
  STRUCTURED: 'primary',
  SENT: 'success',
  ARCHIVED: 'neutral',
  COMPLETED: 'purple',
};
const requestStatusLabels: Record<string, string> = {
  INBOX: 'En bandeja',
  STRUCTURED: 'Estructurada',
  SENT: 'En Jira',
  ARCHIVED: 'Archivada',
  COMPLETED: 'Completada',
};
export function RequestStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={requestStatusTones[status] ?? 'neutral'} dot>
      {requestStatusLabels[status] ?? status}
    </Badge>
  );
}

const requestTypeTones: Record<string, Tone> = {
  MEJORA: 'info',
  FEATURE: 'purple',
  AJUSTE: 'warning',
  BUG: 'danger',
};
const requestTypeLabels: Record<string, string> = {
  MEJORA: 'Mejora',
  FEATURE: 'Feature',
  AJUSTE: 'Ajuste',
  BUG: 'Bug',
};
export function RequestTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  return (
    <Badge tone={requestTypeTones[type] ?? 'neutral'}>
      {requestTypeLabels[type] ?? type}
    </Badge>
  );
}

const requestPriorityTones: Record<string, Tone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'danger',
};
const requestPriorityLabels: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
};
export function RequestPriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  return (
    <Badge tone={requestPriorityTones[priority] ?? 'neutral'}>
      Prioridad {requestPriorityLabels[priority] ?? priority}
    </Badge>
  );
}
