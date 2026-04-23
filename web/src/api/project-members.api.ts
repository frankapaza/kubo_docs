import { api } from './client';
import type { ProjectMember, ProjectMemberRole } from './types';

export const projectMembersApi = {
  list: (projectId: number) =>
    api.get<ProjectMember[]>(`/projects/${projectId}/members`).then((r) => r.data),
  add: (projectId: number, body: { userId: number; roleInProject?: ProjectMemberRole }) =>
    api.post<ProjectMember>(`/projects/${projectId}/members`, body).then((r) => r.data),
  remove: (projectId: number, userId: number) =>
    api.delete<{ ok: true }>(`/projects/${projectId}/members/${userId}`).then((r) => r.data),
};
