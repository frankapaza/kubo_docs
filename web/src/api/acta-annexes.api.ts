import { api } from './client';

export interface ActaAnnex {
  id: number;
  actaId: number;
  position: number;
  section: string | null;
  place: 'ANEXO' | 'INLINE';
  caption: string | null;
  imageMime: string | null;
  hasImage: boolean;
  createdAt: string;
}

export interface MeetingNote {
  id: number;
  meetingId: number;
  offsetSec: number;
  kind: 'NOTA' | 'ACUERDO' | 'TAREA';
  text: string;
  createdAt: string;
}

/**
 * Comprime una foto del iPad antes de subirla (JPEG, lado mayor 1600 px): una foto de
 * 12 MP pesa varios MB y el anexo no necesita tanto.
 */
export async function compressPhoto(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality));
}

export const actaAnnexesApi = {
  list: (actaId: number) => api.get<ActaAnnex[]>(`/actas/${actaId}/annexes`).then((r) => r.data),
  create: async (actaId: number, input: { caption?: string; photo?: File | null; section?: string; place?: 'ANEXO' | 'INLINE' }) => {
    const form = new FormData();
    if (input.caption) form.append('caption', input.caption);
    if (input.section) form.append('section', input.section);
    if (input.place) form.append('place', input.place);
    if (input.photo) form.append('file', await compressPhoto(input.photo), 'evidencia.jpg');
    return api.post<ActaAnnex>(`/actas/${actaId}/annexes`, form).then((r) => r.data);
  },
  update: (id: number, body: { caption?: string; position?: number; place?: 'ANEXO' | 'INLINE' }) =>
    api.patch<ActaAnnex>(`/acta-annexes/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/acta-annexes/${id}`).then(() => undefined),
  imagePath: (id: number) => `/acta-annexes/${id}/image`,
};

export const meetingNotesApi = {
  list: (meetingId: number) => api.get<MeetingNote[]>(`/meetings/${meetingId}/notes`).then((r) => r.data),
  create: (meetingId: number, body: { offsetSec: number; kind: MeetingNote['kind']; text: string }) =>
    api.post<MeetingNote>(`/meetings/${meetingId}/notes`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/meeting-notes/${id}`).then(() => undefined),
};
