import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AIProvider } from './entities/ai-provider.entity';
import { AIProvidersRepository } from './ai-providers.repository';
import { AIProvidersService } from './ai-providers.service';
import { AIProvidersController } from './ai-providers.controller';
import { LLMService } from './llm.service';

@Module({
  imports: [TypeOrmModule.forFeature([AIProvider])],
  providers: [AIProvidersRepository, AIProvidersService, LLMService],
  controllers: [AIProvidersController],
  exports: [LLMService],
})
export class AIModule {}
