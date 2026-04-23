import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [AIModule],
  providers: [AgentsService],
  controllers: [AgentsController],
})
export class AgentsModule {}
