import { api } from './client';
import type {
  Acta,
  AudioFile,
  BacklogResult,
  Meeting,
  MeetingType,
  Paginated,
  Transcription,
} from './types';

export const meetingsApi = {
  listByProject: (projectId: number) =>
    api.get<Paginated<Meeting>>('/meetings', { params: { projectId } }).then((r) => r.data),
  create: (body: {
    projectId: number;
    title: string;
    description?: string;
    scheduledAt: string;
    location?: string;
    meetingType?: MeetingType;
  }) => api.post<Meeting>('/meetings', body).then((r) => r.data),
  findOne: (id: number) => api.get<Meeting>(`/meetings/${id}`).then((r) => r.data),
  uploadAudio: (meetingId: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('source', 'WEB');
    return api
      .post(`/meetings/${meetingId}/audio`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
  getTranscription: (meetingId: number) =>
    api.get<Transcription | null>(`/meetings/${meetingId}/transcription`).then((r) => r.data),
  getAudio: (meetingId: number) =>
    api.get<AudioFile | null>(`/meetings/${meetingId}/audio`).then((r) => r.data),
  getAudioBlobUrl: async (audioId: number) => {
    const res = await api.get(`/audio/${audioId}/stream`, { responseType: 'blob' });
    const blob = new Blob([res.data], { type: res.headers['content-type'] || 'audio/webm' });
    return URL.createObjectURL(blob);
  },
  generateActa: (meetingId: number) =>
    api.post<Acta>(`/meetings/${meetingId}/acta/generate`).then((r) => r.data),
  getActa: (meetingId: number) =>
    api.get<Acta | null>(`/meetings/${meetingId}/acta`).then((r) => r.data),
  update: (id: number, body: Partial<{ title: string; description: string; scheduledAt: string; location: string; status: Meeting['status'] }>) =>
    api.patch<Meeting>(`/meetings/${id}`, body).then((r) => r.data),
  close: (id: number) =>
    api.patch<Meeting>(`/meetings/${id}`, { status: 'CLOSED' }).then((r) => r.data),
  reopen: (id: number) =>
    api.patch<Meeting>(`/meetings/${id}`, { status: 'SCHEDULED' }).then((r) => r.data),
};

export const actasApi = {
  findOne: (id: number) => api.get<Acta>(`/actas/${id}`).then((r) => r.data),
  update: (id: number, contentMarkdown: string) =>
    api.patch<Acta>(`/actas/${id}`, { contentMarkdown }).then((r) => r.data),
  submitReview: (id: number) => api.post<Acta>(`/actas/${id}/submit-review`).then((r) => r.data),
  approve: (id: number) => api.post<Acta>(`/actas/${id}/approve`).then((r) => r.data),
  regenerate: (id: number) => api.post<Acta>(`/actas/${id}/regenerate`).then((r) => r.data),
  generateBacklog: (id: number) =>
    api.post<BacklogResult>(`/actas/${id}/backlog`).then((r) => r.data),
  downloadPdf: async (id: number) => {
    const res = await api.get(`/actas/${id}/pdf`, { responseType: 'blob' });
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `acta-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
