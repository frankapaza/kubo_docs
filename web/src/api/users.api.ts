import { api } from './client';
import type { User, UserRole } from './types';

export const usersApi = {
  list: () => api.get<User[]>('/users').then((r) => r.data),
  updateRole: (id: number, role: UserRole) =>
    api.patch<User>(`/users/${id}/role`, { role }).then((r) => r.data),
};
