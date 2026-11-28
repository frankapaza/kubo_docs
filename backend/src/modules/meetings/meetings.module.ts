import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Meeting } from './entities/meeting.entity';
import { MeetingsService } from './meetings.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsRepository } from './meetings.repository';
import { ProjectsModule } from '../projects/projects.module';

import { MeetingNote } from './entities/meeting-note.entity';
import { MeetingNotesController } from './meeting-notes.controller';
import { MeetingNotesService } from './meeting-notes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Meeting, MeetingNote]), ProjectsModule],
  providers: [MeetingsService, MeetingsRepository, MeetingNotesService],
  controllers: [MeetingsController, MeetingNotesController],
  exports: [MeetingsService, MeetingNotesService],
})
export class MeetingsModule {}
