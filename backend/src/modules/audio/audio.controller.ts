import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Response } from 'express';
import { AudioService } from './audio.service';
import { ACCEPTED_AUDIO_MIME } from './audio.constants';
import { UploadAudioDto } from './dto/upload-audio.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { MulterExceptionFilter } from './filters/multer-exception.filter';

const AUDIO_MAX_MB = parseInt(process.env.AUDIO_MAX_SIZE_MB ?? '100', 10);
const UPLOAD_TMP_DIR = path.join(
  path.resolve(process.env.STORAGE_LOCAL_PATH ?? './uploads'),
  'tmp',
);
fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

@Controller()
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
@UseFilters(MulterExceptionFilter)
export class AudioController {
  constructor(private readonly service: AudioService) {}

  @Post('meetings/:meetingId/audio')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_TMP_DIR,
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname) || '.bin';
          cb(null, `${Date.now()}_${crypto.randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: AUDIO_MAX_MB * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ACCEPTED_AUDIO_MIME.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new UnsupportedMediaTypeException({
              code: 'UNSUPPORTED_MEDIA_TYPE',
              message: `MIME ${file.mimetype} no soportado`,
            }),
            false,
          );
        }
      },
    }),
  )
  async upload(
    @Param('meetingId', ParseIntPipe) meetingId: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAudioDto,
    @CurrentUser() user: AuthUser,
  ) {
    const { audio, transcription } = await this.service.upload({
      meetingId,
      userId: user.id,
      file,
      dto,
    });
    return {
      id: Number(audio.id),
      meetingId: audio.meetingId,
      storageKey: audio.storageKey,
      mimeType: audio.mimeType,
      sizeBytes: Number(audio.sizeBytes),
      source: audio.source,
      transcription: {
        id: Number(transcription.id),
        status: transcription.status,
      },
    };
  }

  @Get('audio/:id')
  async metadata(@Param('id', ParseIntPipe) id: number) {
    return this.service.findByIdOrFail(id);
  }

  @Get('meetings/:meetingId/audio')
  async findByMeeting(@Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.service.findByMeeting(meetingId);
  }

  @Get('audio/:id/stream')
  async stream(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const audio = await this.service.findByIdOrFail(id);
    if (audio.deletedAt) {
      res.status(410).json({
        code: 'AUDIO_DELETED',
        message: 'El audio ya no está disponible (política de retención).',
        deletedAt: audio.deletedAt,
        deletedReason: audio.deletedReason,
      });
      return;
    }
    res.setHeader('Content-Type', audio.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${audio.originalFilename}"`);
    this.service.streamFor(audio).pipe(res);
  }
}
