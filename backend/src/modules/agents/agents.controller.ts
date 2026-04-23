import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AgentsService } from './agents.service';
import { AgentChatDto } from './dto/agent-chat.dto';

@Controller('agents')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(private readonly service: AgentsService) {}

  @Post('chat')
  @HttpCode(200)
  chat(@Body() dto: AgentChatDto) {
    return this.service.chat(dto);
  }
}
