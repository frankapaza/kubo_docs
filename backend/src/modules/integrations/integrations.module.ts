import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Integration } from './entities/integration.entity';
import { IntegrationsRepository } from './integrations.repository';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { JiraService } from './jira.service';

@Module({
  imports: [TypeOrmModule.forFeature([Integration])],
  providers: [IntegrationsRepository, IntegrationsService, JiraService],
  controllers: [IntegrationsController],
  exports: [IntegrationsService, JiraService],
})
export class IntegrationsModule {}
