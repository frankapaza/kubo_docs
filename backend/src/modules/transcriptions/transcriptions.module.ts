import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Transcription } from './entities/transcription.entity';
import { AudioFile } from '../audio/entities/audio-file.entity';
import { TranscriptionsService } from './transcriptions.service';
import { TranscriptionsController } from './transcriptions.controller';
import { TranscriptionProcessor } from './transcription.processor';
import { WhisperTranscriptionProvider } from './providers/whisper.provider';
import { TRANSCRIPTION_PROVIDER } from './interfaces/transcription-provider.interface';
import { AudioModule } from '../audio/audio.module';
import { MeetingsModule } from '../meetings/meetings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transcription, AudioFile]),
    BullModule.registerQueue({ name: 'transcription' }),
    forwardRef(() => AudioModule),
    MeetingsModule,
  ],
  providers: [
    TranscriptionsService,
    TranscriptionProcessor,
    { provide: TRANSCRIPTION_PROVIDER, useClass: WhisperTranscriptionProvider },
  ],
  controllers: [TranscriptionsController],
  exports: [TranscriptionsService, TRANSCRIPTION_PROVIDER],
})
export class TranscriptionsModule {}
