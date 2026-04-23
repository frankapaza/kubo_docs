import { api } from './client';

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
}

export const signaturesApi = {
  list: (actaId: number) =>
    api.get<ActaSignature[]>(`/actas/${actaId}/signatures`).then((r) => r.data),
  sign: (actaId: number, participantId: number) =>
    api
      .post<ActaSignature>(`/actas/${actaId}/signatures`, { participantId })
      .then((r) => r.data),
  revoke: (actaId: number, signatureId: number) =>
    api
      .delete<{ ok: true }>(`/actas/${actaId}/signatures/${signatureId}`)
      .then((r) => r.data),
};
