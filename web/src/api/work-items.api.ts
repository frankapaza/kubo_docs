import { api } from './client';
import type {
  WorkItem, WorkItemDetail, WorkItemStatus, WorkItemPriority,
} from './types';

export interface WorkItemListParams {
  clientId?: number;
  projectId?: number;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  assigneeId?: number;
  dueFilter?: 'vencidos' | 'semana';
  q?: string;
}

export interface CreateWorkItemBody {
  clientId: number;
  projectId?: number;
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
  accept: (id: number, body: { priority: WorkItemPriority; committedDate: string }) =>
    api.post<WorkItem>(`/work-items/${id}/accept`, body).then((r) => r.data),

  /** Rechazar exige motivo, igual que el resto de estados fuera de flujo. */
  reject: (id: number, body: { reason: string }) =>
    api.post<WorkItem>(`/work-items/${id}/reject`, body).then((r) => r.data),
};
