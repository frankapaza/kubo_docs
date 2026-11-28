import { api } from './client';

export type SignatureMethod = 'USER' | 'IN_PERSON' | 'EMAIL' | 'BOTH' | 'REMOTE';

export interface ActaSignature {
  id: number;
  actaId: number;
  participantId: number;
  signedByUser: number | null;
  signerName: string;
  signerDocument: string | null;
  signerRole: string | null;
  signatureHash: string;
  signedAt: string;
  ipAddress: string | null;
  method: SignatureMethod;
  confirmEmail: string | null;
  confirmExpiresAt: string | null;
  emailConfirmedAt: string | null;
}

/** Datos de quien firma: participante existente, o nombre y DNI de un asistente nuevo. */
export interface SignerInput {
  participantId?: number;
  signerName?: string;
  signerDocument?: string;
  signerRole?: string;
}

/** Firma completa: con usuario o trazo, sí; por correo o ambos, cuando confirmó. */
export const isComplete = (s: Pick<ActaSignature, 'method' | 'emailConfirmedAt'>) =>
  s.method === 'EMAIL' || s.method === 'BOTH' || s.method === 'REMOTE' ? !!s.emailConfirmedAt : true;

export const signaturesApi = {
  list: (actaId: number) =>
    api.get<ActaSignature[]>(`/actas/${actaId}/signatures`).then((r) => r.data),
  sign: (actaId: number, participantId: number) =>
    api
      .post<ActaSignature>(`/actas/${actaId}/signatures`, { participantId })
      .then((r) => r.data),
  /** Trazo en el iPad (dedo o Apple Pencil). */
  signInPerson: (actaId: number, body: SignerInput & { signaturePng: string }) =>
    api.post<ActaSignature>(`/actas/${actaId}/signatures/in-person`, body).then((r) => r.data),
  /** Por correo (EMAIL) o trazo + correo (BOTH). */
  signByEmail: (actaId: number, body: SignerInput & { mode: 'EMAIL' | 'BOTH' | 'REMOTE'; signerEmail?: string; signaturePng?: string }) =>
    api.post<ActaSignature>(`/actas/${actaId}/signatures/email`, body).then((r) => r.data),
  /** Reunión por Meet: enlace de firma a distancia a todos los asistentes con correo que no firmaron. */
  remoteAll: (actaId: number) =>
    api.post<{ sent: string[]; skipped: Array<{ name: string; reason: string }> }>(`/actas/${actaId}/signatures/remote-all`).then((r) => r.data),
  imagePath: (actaId: number, signatureId: number) => `/actas/${actaId}/signatures/${signatureId}/image`,
  revoke: (actaId: number, signatureId: number) =>
    api
      .delete<{ ok: true }>(`/actas/${actaId}/signatures/${signatureId}`)
      .then((r) => r.data),
};

/** Página pública de confirmación por correo (sin sesión). */
export const actaSignPublicApi = {
  preview: (token: string) =>
    api
      .get<{ signerName: string; meetingTitle: string; actaMarkdown: string; status: 'PENDIENTE' | 'CONFIRMADA'; needsDrawing: boolean }>(`/acta-sign/${encodeURIComponent(token)}`)
      .then((r) => r.data),
  confirm: (token: string, signaturePng?: string) =>
    api.post<{ ok: true; signerName: string; confirmedAt: string }>(`/acta-sign/${encodeURIComponent(token)}/confirm`, signaturePng ? { signaturePng } : {}).then((r) => r.data),
};
