import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AudioFile } from './entities/audio-file.entity';
import { Transcription } from '../transcriptions/entities/transcription.entity';
import { AudioService } from './audio.service';
import { AudioController } from './audio.controller';
import { LocalStorageService } from './services/local-storage.service';
import { AudioRetentionService } from './services/audio-retention.service';
import { STORAGE_SERVICE } from './interfaces/storage.interface';
import { MeetingsModule } from '../meetings/meetings.module';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AudioFile, Transcription]),
    BullModule.registerQueue({ name: 'transcription' }),
    MeetingsModule,
    WorkspaceModule,
  ],
  providers: [
    AudioService,
    AudioRetentionService,
    { provide: STORAGE_SERVICE, useClass: LocalStorageService },
  ],
  controllers: [AudioController],
  exports: [AudioService, AudioRetentionService, STORAGE_SERVICE],
})
export class AudioModule {}
