import { api } from './client';
import type { Deliverable } from './expediente.api';

export interface DocSection {
  key: string;
  num: string;
  title: string;
  body: string;
}

export interface TemplateSection {
  num: string;
  title: string;
  guide?: string;
}

export type TemplateSource = 'CLIENTE' | 'KUBO_EDITADA' | 'KUBO';

export interface DocAttachment {
  id: number;
  sectionKey: string;
  place: 'INLINE' | 'ANEXO';
  caption: string | null;
  position: number;
  imageMime: string;
}

export interface DeliverableDocument {
  deliverable: Deliverable;
  saved: boolean;
  baseVersion: string | null;
  documentVersion: string | null;
  template: { source: TemplateSource; name: string };
  sections: (DocSection & { status: 'COMPLETA' | 'PENDIENTE' })[];
  attachments: DocAttachment[];
  attachmentsEditable: boolean;
}

export type DiffOp = { op: 'eq' | 'del' | 'ins'; text: string };

export interface AiChange {
  key: string;
  num: string;
  title: string;
  before: string;
  after: string;
  diff: DiffOp[];
}

export interface ResolvedTemplate {
  type: string;
  clientId: number | null;
  source: TemplateSource;
  name: string;
  sections: TemplateSection[];
  clientName?: string | null;
  updatedAt?: string;
}

export const AI_PRESETS = ['Más formal', 'Más breve', 'Completar lo pendiente', 'Ajustar al formato del cliente', 'Corregir ortografía'];

const base = (projectId: number, id: number) => `/projects/${projectId}/expediente/deliverables/${id}/document`;

export const deliverableDocumentApi = {
  get: (projectId: number, id: number) => api.get<DeliverableDocument>(base(projectId, id)).then((r) => r.data),
  save: (projectId: number, id: number, body: { sections: DocSection[]; baseVersion: string | null; note?: string }) =>
    api.put<DeliverableDocument>(base(projectId, id), body).then((r) => r.data),
  aiAdjust: (
    projectId: number,
    id: number,
    body: { scope: 'SECTION' | 'DOCUMENT'; sectionKey?: string; instruction: string; sections: DocSection[] },
  ) => api.post<{ changes: AiChange[]; unchanged: string[] }>(`${base(projectId, id)}/ai-adjust`, body).then((r) => r.data),
  pdf: async (projectId: number, id: number, filename: string) => {
    const res = await api.get(`${base(projectId, id)}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  addAttachment: (projectId: number, id: number, input: { file: Blob; sectionKey: string; place: 'INLINE' | 'ANEXO'; caption?: string }) => {
    const form = new FormData();
    form.append('file', input.file, 'imagen.jpg');
    form.append('sectionKey', input.sectionKey);
    form.append('place', input.place);
    if (input.caption) form.append('caption', input.caption);
    return api.post<DocAttachment>(`${base(projectId, id)}/attachments`, form).then((r) => r.data);
  },
  updateAttachment: (projectId: number, id: number, attachmentId: number, patch: { caption?: string | null; place?: 'INLINE' | 'ANEXO' }) =>
    api.patch<DocAttachment>(`${base(projectId, id)}/attachments/${attachmentId}`, patch).then((r) => r.data),
  removeAttachment: (projectId: number, id: number, attachmentId: number) =>
    api.delete(`${base(projectId, id)}/attachments/${attachmentId}`).then(() => undefined),
  importSchedule: (projectId: number, id: number, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return api
      .post<{ rows: { activity: string; owner: string; start: string; end: string }[]; markdown: string }>(`${base(projectId, id)}/schedule-import`, form)
      .then((r) => r.data);
  },
  imagePath: (projectId: number, id: number, attachmentId: number) => `${base(projectId, id)}/attachments/${attachmentId}/image`,
};

export const deliverableTemplatesApi = {
  list: () => api.get<ResolvedTemplate[]>('/deliverable-templates').then((r) => r.data),
  get: (type: string, clientId: number | null) =>
    api.get<ResolvedTemplate>(`/deliverable-templates/${type}`, { params: clientId ? { clientId } : {} }).then((r) => r.data),
  save: (type: string, body: { clientId: number | null; name: string; sections: TemplateSection[] }) =>
    api.put<ResolvedTemplate>(`/deliverable-templates/${type}`, body).then((r) => r.data),
  remove: (type: string, clientId: number | null) =>
    api.delete(`/deliverable-templates/${type}`, { params: clientId ? { clientId } : {} }).then(() => undefined),
};
