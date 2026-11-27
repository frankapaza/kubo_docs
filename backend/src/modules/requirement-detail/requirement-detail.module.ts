import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AIModule } from '../ai/ai.module';
import { ClientsModule } from '../clients/clients.module';
import { EmailModule } from '../email/email.module';
import { PortalModule } from '../portal/portal.module';
import { WorkItemsModule } from '../work-items/work-items.module';
import { RequirementDetailController } from './requirement-detail.controller';
import { RequirementDetailService } from './requirement-detail.service';

/**
 * Requerimientos mejor explicados: «Pedir más detalle» y «Redactar
 * especificación con IA». Módulo aparte para no meter correo, portal e IA en
 * el módulo de requerimientos (y no crear un ciclo con el portal, que ya
 * depende de requerimientos).
 */
@Module({
  imports: [ConfigModule, AIModule, ClientsModule, EmailModule, PortalModule, WorkItemsModule],
  controllers: [RequirementDetailController],
  providers: [RequirementDetailService],
})
export class RequirementDetailModule {}
