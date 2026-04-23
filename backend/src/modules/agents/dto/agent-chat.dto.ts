import { IsArray, IsEnum, IsIn, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AgentType } from '../agent-prompts';

class ChatMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(20000)
  content!: string;
}

export class AgentChatDto {
  @IsEnum(['agility', 'documentation'])
  agentType!: AgentType;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}
