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

@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectMember, ProjectDeliverable, ProjectDeliverableVersion, User]),
    UsersModule,
    StorageModule,
  ],
  providers: [
    ProjectsService,
    ProjectsRepository,
    ProjectMembersService,
    ProjectMembersRepository,
    ExpedienteService,
  ],
  controllers: [ProjectsController, ProjectMembersController, ExpedienteController],
  exports: [ProjectsService, ProjectMembersService],
})
export class ProjectsModule {}
