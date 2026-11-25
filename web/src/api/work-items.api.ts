import { api } from './client';
import type {
  WorkItem, WorkItemDetail, WorkItemStatus, WorkItemPriority,
} from './types';

export interface WorkItemListParams {
  clientId?: number;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  assigneeId?: number;
  dueFilter?: 'vencidos' | 'semana';
  q?: string;
}

export interface CreateWorkItemBody {
  clientId: number;
  /** Asignación cliente-sistema (conector de Claude). `null` la quita al editar. */
  clientSystemId?: number | null;
  title: string;
  descriptionMd?: string;
  acceptanceCriteria?: string[];
  labels?: string[];
  priority?: WorkItemPriority;
  assigneeUserId?: number;
  dueDate?: string;
}

export const workItemsApi = {
  list: (params?: WorkItemListParams) =>
    api.get<WorkItem[]>('/work-items', { params }).then((r) => r.data),

  findOne: (id: number) => api.get<WorkItemDetail>(`/work-items/${id}`).then((r) => r.data),

  create: (body: CreateWorkItemBody) =>
    api.post<WorkItem>('/work-items', body).then((r) => r.data),

  update: (id: number, body: Partial<Omit<CreateWorkItemBody, 'priority'>>) =>
    api.patch<WorkItem>(`/work-items/${id}`, body).then((r) => r.data),

  remove: (id: number) => api.delete<{ ok: true }>(`/work-items/${id}`).then((r) => r.data),

  move: (id: number, body: { toStatus: WorkItemStatus; toIndex: number; reason?: string }) =>
    api.post<WorkItem>(`/work-items/${id}/move`, body).then((r) => r.data),

  assign: (id: number, body: { assigneeUserId: number | null }) =>
    api.post<WorkItem>(`/work-items/${id}/assign`, body).then((r) => r.data),

  changePriority: (id: number, body: { priority: WorkItemPriority; reason?: string }) =>
    api.post<WorkItem>(`/work-items/${id}/priority`, body).then((r) => r.data),

  /** Aceptar fija prioridad y fecha comprometida y lo mete en PENDIENTE (tarea 9). */
  accept: (id: number, body: { priority: WorkItemPriority; committedDate: string; clientSystemId?: number }) =>
    api.post<WorkItem>(`/work-items/${id}/accept`, body).then((r) => r.data),

  /** Rechazar exige motivo, igual que el resto de estados fuera de flujo. */
  reject: (id: number, body: { reason: string }) =>
    api.post<WorkItem>(`/work-items/${id}/reject`, body).then((r) => r.data),
};

export type WorkItemDocKind = 'ESPECIFICACION' | 'MANUAL_USUARIO' | 'ACTA_CONFORMIDAD' | 'OTRO';

export const WORK_ITEM_DOC_KIND_LABELS: Record<WorkItemDocKind, string> = {
  ESPECIFICACION: 'Especificación del requerimiento',
  MANUAL_USUARIO: 'Manual de usuario',
  ACTA_CONFORMIDAD: 'Acta de conformidad',
  OTRO: 'Otro',
};

export interface WorkItemDoc {
  id: number;
  workItemId: number;
  kind: WorkItemDocKind;
  kindLabel: string;
  status: 'BORRADOR' | 'VIGENTE';
  source: 'WEB' | 'CLAUDE';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: number | null;
  approvedByUserId: number | null;
  approvedAt: string | null;
  createdAt: string;
}

/** Documentos de un requerimiento: Especificación, Manual de usuario, Acta de conformidad y otros. */
export const workItemDocsApi = {
  list: (workItemId: number) =>
    api.get<WorkItemDoc[]>(`/work-items/${workItemId}/documents`).then((r) => r.data),

  upload: (workItemId: number, kind: WorkItemDocKind, file: File) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file, file.name);
    return api.post<WorkItemDoc>(`/work-items/${workItemId}/documents`, form).then((r) => r.data);
  },

  approve: (workItemId: number, docId: number) =>
    api.post<WorkItemDoc>(`/work-items/${workItemId}/documents/${docId}/approve`).then((r) => r.data),

  remove: (workItemId: number, docId: number) =>
    api.delete<{ ok: true }>(`/work-items/${workItemId}/documents/${docId}`).then((r) => r.data),

  download: async (workItemId: number, doc: WorkItemDoc) => {
    const res = await api.get(`/work-items/${workItemId}/documents/${doc.id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: doc.mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
