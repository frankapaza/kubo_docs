import { api } from './client';
import type { Participant } from './types';

export interface CreateParticipantBody {
  userId?: number;
  fullName: string;
  documentNumber?: string;
  email?: string;
  role?: string;
  attended?: boolean;
}

export type UpdateParticipantBody = Partial<CreateParticipantBody>;

export const participantsApi = {
  list: (meetingId: number) =>
    api.get<Participant[]>(`/meetings/${meetingId}/participants`).then((r) => r.data),
  create: (meetingId: number, body: CreateParticipantBody) =>
    api.post<Participant>(`/meetings/${meetingId}/participants`, body).then((r) => r.data),
  update: (id: number, body: UpdateParticipantBody) =>
    api.patch<Participant>(`/participants/${id}`, body).then((r) => r.data),
  remove: (id: number) =>
    api.delete<void>(`/participants/${id}`).then((r) => r.data),
};
