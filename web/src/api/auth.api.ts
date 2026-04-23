import { api } from './client';
import type { User } from './types';

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { email, password }).then((r) => r.data),
  register: (body: { email: string; password: string; fullName: string }) =>
    api.post<AuthResponse>('/auth/register', body).then((r) => r.data),
  me: () => api.get<User>('/users/me').then((r) => r.data),
};
