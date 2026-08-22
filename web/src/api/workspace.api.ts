import { api } from './client';

export type AudioRetentionPolicy =
  | 'KEEP_FOREVER'
  | 'DELETE_AFTER_APPROVAL'
  | 'DELETE_AFTER_DAYS'
  | 'NEVER_STORE';

export interface WorkspaceSettings {
  id: number;
  razonSocial: string;
  ruc: string | null;
  legalRepName: string | null;
  legalRepDoc: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;

  sessionTimeoutMinutes: number;

  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: number;
  smtpUser: string | null;
  smtpFrom: string | null;
  // `smtpPassEncrypted` se devuelve pero nunca se usa en el frontend.
  smtpPassEncrypted?: string | null;

  // Buzón del equipo para los avisos internos de tickets (ticket nuevo desde
  // el portal, SLA en riesgo). `null` = sin configurar: esos avisos caen al
  // remitente SMTP (`smtpFrom`).
  teamInboxEmail: string | null;

  // IMAP (correo entrante). `imapEnabled` nace apagado (0): la ingesta no
  // debe encenderse sin verificar antes, en el servidor real, que
  // `Authentication-Results` la pone nuestro propio servidor y que rechaza en
  // el sobre lo que no pase DMARC.
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: number;
  imapUser: string | null;
  imapFolder: string | null;
  imapEnabled: number;
  // `imapPassEncrypted` se devuelve pero nunca se usa en el frontend.
  imapPassEncrypted?: string | null;
  // El identificador del propio servidor de correo (`authserv-id`, RFC 8601
  // §2.2): el ancla contra una cabecera `Authentication-Results` que el
  // propio remitente fabricó dentro de su mensaje. `null` = sin configurar,
  // y sin él ningún correo autentica nunca (falla cerrado).
  imapAuthServerId: string | null;

  audioRetentionPolicy: AudioRetentionPolicy;
  audioRetentionDays: number;

  updatedAt: string;
}

export interface UpdateWorkspaceBody {
  razonSocial?: string;
  ruc?: string;
  legalRepName?: string;
  legalRepDoc?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logoUrl?: string;

  sessionTimeoutMinutes?: number;

  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  // Se envía solo si cambia; el backend lo encripta.
  smtpPass?: string;
  smtpFrom?: string;

  // Cadena vacía = limpiarlo (el backend lo admite: ver `IsString`, no
  // `IsEmail`, en `UpdateWorkspaceSettingsDto.teamInboxEmail`).
  teamInboxEmail?: string;

  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapUser?: string;
  // Se envía solo si cambia; el backend lo encripta.
  imapPass?: string;
  imapFolder?: string;
  // El interruptor de encendido de la ingesta. Nace apagado.
  imapEnabled?: boolean;
  imapAuthServerId?: string;

  audioRetentionPolicy?: AudioRetentionPolicy;
  audioRetentionDays?: number;
}

export const workspaceApi = {
  get: () => api.get<WorkspaceSettings>('/workspace-settings').then((r) => r.data),
  update: (body: UpdateWorkspaceBody) =>
    api.patch<WorkspaceSettings>('/workspace-settings', body).then((r) => r.data),
  testSmtp: () =>
    api.post<{ ok: true; sentTo: string }>('/email/test-smtp').then((r) => r.data),
};
