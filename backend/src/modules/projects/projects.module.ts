import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './entities/project.entity';
import { ProjectMember } from './entities/project-member.entity';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { ProjectsRepository } from './projects.repository';
import { ProjectMembersService } from './project-members.service';
import { ProjectMembersRepository } from './project-members.repository';
import { ProjectMembersController } from './project-members.controller';
import { UsersModule } from '../users/users.module';
import { User } from '../users/entities/user.entity';
import { StorageModule } from '../../common/storage/storage.module';
import { ProjectDeliverable } from './expediente/entities/project-deliverable.entity';
import { ProjectDeliverableVersion } from './expediente/entities/project-deliverable-version.entity';
import { ExpedienteService } from './expediente/expediente.service';
import { ExpedienteController } from './expediente/expediente.controller';
import { Client } from '../clients/entities/client.entity';
import { AIModule } from '../ai/ai.module';
import { DeliverableTemplate } from './expediente/entities/deliverable-template.entity';
import { DeliverableAttachment } from './expediente/entities/deliverable-attachment.entity';
import { DeliverableDocumentService } from './expediente/deliverable-document.service';
import {
  DeliverableDocumentController,
  DeliverableTemplatesController,
} from './expediente/deliverable-document.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectMember, ProjectDeliverable,
      ProjectDeliverableVersion,
      User,
      Client,
      DeliverableTemplate,
      DeliverableAttachment,
    ]),
    AIModule,
    UsersModule,
    StorageModule,
  ],
  providers: [
    ProjectsService,
    ProjectsRepository,
    ProjectMembersService,
    ProjectMembersRepository,
    ExpedienteService,
    DeliverableDocumentService,
  ],
  controllers: [ProjectsController, ProjectMembersController, ExpedienteController,
    DeliverableDocumentController,
    DeliverableTemplatesController,
  ],
  exports: [ProjectsService, ProjectMembersService],
})
export class ProjectsModule {}
