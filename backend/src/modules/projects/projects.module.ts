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

@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectMember]), UsersModule],
  providers: [
    ProjectsService,
    ProjectsRepository,
    ProjectMembersService,
    ProjectMembersRepository,
  ],
  controllers: [ProjectsController, ProjectMembersController],
  exports: [ProjectsService, ProjectMembersService],
})
export class ProjectsModule {}
