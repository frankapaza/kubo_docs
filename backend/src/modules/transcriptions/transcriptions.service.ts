import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Transcription, TranscriptionStatus } from './entities/transcription.entity';
import { AudioFile } from '../audio/entities/audio-file.entity';
import { UpdateTranscriptionDto } from './dto/update-transcription.dto';
import {
  ITranscriptionProvider,
  TRANSCRIPTION_PROVIDER,
} from './interfaces/transcription-provider.interface';
import { IStorageService, STORAGE_SERVICE } from '../audio/interfaces/storage.interface';
import { MeetingsService } from '../meetings/meetings.service';
import { AudioRetentionService } from '../audio/services/audio-retention.service';

@Injectable()
export class TranscriptionsService {
  private readonly logger = new Logger(TranscriptionsService.name);

  constructor(
    @InjectRepository(Transcription)
    private readonly repo: Repository<Transcription>,
    @InjectRepository(AudioFile)
    private readonly audioRepo: Repository<AudioFile>,
    @Inject(TRANSCRIPTION_PROVIDER)
    private readonly provider: ITranscriptionProvider,
    @Inject(STORAGE_SERVICE)
    private readonly storage: IStorageService,
    @InjectQueue('transcription') private readonly queue: Queue,
    private readonly meetings: MeetingsService,
    @Inject(forwardRef(() => AudioRetentionService))
    private readonly retention: AudioRetentionService,
  ) {}

  async findByIdOrFail(id: number): Promise<Transcription> {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Transcripción no encontrada' });
    }
    return t;
  }

  async findByMeeting(meetingId: number): Promise<Transcription | null> {
    return this.repo
      .createQueryBuilder('t')
      .innerJoin(AudioFile, 'a', 'a.id = t.audio_file_id')
      .where('a.meeting_id = :meetingId', { meetingId })
      .orderBy('t.created_at', 'DESC')
      .getOne();
  }

  async update(id: number, dto: UpdateTranscriptionDto): Promise<Transcription> {
    const t = await this.findByIdOrFail(id);
    Object.assign(t, dto);
    return this.repo.save(t);
  }

  async retry(id: number): Promise<Transcription> {
    const t = await this.findByIdOrFail(id);
    if (t.status !== 'FAILED') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'Solo transcripciones fallidas pueden reintentarse',
      });
    }
    t.status = 'PENDING';
    t.errorMessage = null;
    await this.repo.save(t);
    await this.queue.add('transcribe', { transcriptionId: Number(t.id) });
    return t;
  }

  // --- llamado por el worker -------------------------------------------------
  async process(transcriptionId: number): Promise<void> {
    const t = await this.findByIdOrFail(transcriptionId);
    const audio = await this.audioRepo.findOne({ where: { id: t.audioFileId } });
    if (!audio) throw new Error('Audio asociado no encontrado');

    await this.setStatus(t, 'PROCESSING', { startedAt: new Date() });
    await this.meetings.setStatus(audio.meetingId, 'TRANSCRIBING');

    try {
      const stream = this.storage.createReadStream(audio.storageKey);
      const result = await this.provider.transcribe(stream, audio.mimeType);

      t.status = 'COMPLETED';
      t.contentText = result.text;
      t.contentSegmentsJson = result.segments;
      t.language = result.language;
      t.finishedAt = new Date();
      t.errorMessage = null;
      await this.repo.save(t);
      await this.meetings.setStatus(audio.meetingId, 'TRANSCRIBED');

      // Hook: si la política es NEVER_STORE, borra el archivo de audio ahora mismo.
      try {
        await this.retention.onTranscriptionCompleted(audio.id);
      } catch (e) {
        this.logger.warn(`onTranscriptionCompleted falló: ${(e as Error).message}`);
      }
    } catch (err) {
      t.status = 'FAILED';
      t.errorMessage = (err as Error).message;
      t.finishedAt = new Date();
      await this.repo.save(t);
      throw err;
    }
  }

  private async setStatus(
    t: Transcription,
    status: TranscriptionStatus,
    patch: Partial<Transcription> = {},
  ): Promise<void> {
    t.status = status;
    Object.assign(t, patch);
    await this.repo.save(t);
  }
}
