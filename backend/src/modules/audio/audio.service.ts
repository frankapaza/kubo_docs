import * as crypto from 'crypto';
import * as fs from 'fs';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AudioFile } from './entities/audio-file.entity';
import { UploadAudioDto } from './dto/upload-audio.dto';
import { IStorageService, STORAGE_SERVICE } from './interfaces/storage.interface';
import { MeetingsService } from '../meetings/meetings.service';
import { Transcription } from '../transcriptions/entities/transcription.entity';
import { ACCEPTED_AUDIO_MIME } from './audio.constants';

@Injectable()
export class AudioService {
  constructor(
    @InjectRepository(AudioFile) private readonly audioRepo: Repository<AudioFile>,
    @InjectRepository(Transcription)
    private readonly transcriptionRepo: Repository<Transcription>,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
    @InjectQueue('transcription') private readonly queue: Queue,
    private readonly cfg: ConfigService,
    private readonly meetings: MeetingsService,
  ) {}

  async upload(params: {
    meetingId: number;
    userId: number;
    file: Express.Multer.File;
    dto: UploadAudioDto;
  }): Promise<{ audio: AudioFile; transcription: Transcription }> {
    const { file, meetingId, userId, dto } = params;

    if (!file) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Archivo requerido' });
    }
    if (!ACCEPTED_AUDIO_MIME.includes(file.mimetype)) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: `MIME ${file.mimetype} no soportado`,
      });
    }

    try {
      await this.meetings.findByIdOrFail(meetingId);
    } catch (err) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      throw err;
    }

    const ext = file.originalname.split('.').pop() ?? 'bin';
    const key = `meetings/${meetingId}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    const { size } = await this.storage.saveFromPath(file.path, key, file.mimetype);

    const audio = await this.audioRepo.save(
      this.audioRepo.create({
        meetingId,
        uploadedBy: userId,
        storageKey: key,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: size,
        durationSeconds: dto.durationSeconds ?? null,
        checksumSha256: dto.checksumSha256 ?? null,
        source: dto.source,
      }),
    );

    const transcription = await this.transcriptionRepo.save(
      this.transcriptionRepo.create({
        audioFileId: Number(audio.id),
        status: 'PENDING',
        provider: this.cfg.get<string>('TRANSCRIPTION_PROVIDER', 'whisper-api'),
      }),
    );

    await this.queue.add(
      'transcribe',
      { transcriptionId: Number(transcription.id) },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100 },
    );

    await this.meetings.setStatus(meetingId, 'TRANSCRIBING');

    return { audio, transcription };
  }

  async findByIdOrFail(id: number): Promise<AudioFile> {
    const a = await this.audioRepo.findOne({ where: { id } });
    if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Audio no encontrado' });
    return a;
  }

  async findByMeeting(meetingId: number): Promise<AudioFile | null> {
    return this.audioRepo.findOne({
      where: { meetingId },
      order: { createdAt: 'DESC' },
    });
  }

  streamFor(audio: AudioFile): NodeJS.ReadableStream {
    return this.storage.createReadStream(audio.storageKey);
  }
}
