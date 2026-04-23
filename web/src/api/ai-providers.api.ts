import { api } from './client';

export type AIProviderKind = 'OPENAI' | 'DEEPSEEK' | 'GEMINI' | 'GROQ';

export interface AIProvider {
  id: number;
  provider: AIProviderKind;
  label: string;
  model: string;
  baseUrl: string | null;
  temperature: number;
  isActive: boolean;
  apiKeyPreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAIProviderBody {
  provider: AIProviderKind;
  label: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
}

export type UpdateAIProviderBody = Partial<Omit<CreateAIProviderBody, 'provider'>>;

export const aiProvidersApi = {
  list: () => api.get<AIProvider[]>('/ai/providers').then((r) => r.data),
  create: (body: CreateAIProviderBody) =>
    api.post<AIProvider>('/ai/providers', body).then((r) => r.data),
  update: (id: number, body: UpdateAIProviderBody) =>
    api.patch<AIProvider>(`/ai/providers/${id}`, body).then((r) => r.data),
  activate: (id: number) =>
    api.post<AIProvider>(`/ai/providers/${id}/activate`).then((r) => r.data),
  test: (id: number) =>
    api.post<{ ok: true; sample: string }>(`/ai/providers/${id}/test`).then((r) => r.data),
  remove: (id: number) =>
    api.delete<{ ok: true }>(`/ai/providers/${id}`).then((r) => r.data),
};
