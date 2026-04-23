import { Injectable } from '@nestjs/common';
import { LLMService } from '../ai/llm.service';
import { AGENT_SYSTEM_PROMPTS } from './agent-prompts';
import { AgentChatDto } from './dto/agent-chat.dto';

@Injectable()
export class AgentsService {
  constructor(private readonly llm: LLMService) {}

  async chat(dto: AgentChatDto): Promise<{ reply: string }> {
    const systemPrompt = AGENT_SYSTEM_PROMPTS[dto.agentType];
    const reply = await this.llm.chat(systemPrompt, dto.messages);
    return { reply };
  }
}
