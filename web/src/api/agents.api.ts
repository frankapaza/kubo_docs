import { api } from './client';

export type AgentType = 'agility' | 'documentation';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const agentsApi = {
  chat: (agentType: AgentType, messages: ChatMessage[]): Promise<{ reply: string }> =>
    api.post('/agents/chat', { agentType, messages }).then((r) => r.data),
};
