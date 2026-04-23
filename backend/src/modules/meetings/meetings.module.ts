import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Meeting } from './entities/meeting.entity';
import { MeetingsService } from './meetings.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsRepository } from './meetings.repository';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [TypeOrmModule.forFeature([Meeting]), ProjectsModule],
  providers: [MeetingsService, MeetingsRepository],
  controllers: [MeetingsController],
  exports: [MeetingsService],
})
export class MeetingsModule {}
