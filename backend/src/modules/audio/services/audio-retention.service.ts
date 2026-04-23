import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { AudioFile } from '../entities/audio-file.entity';
import { IStorageService, STORAGE_SERVICE } from '../interfaces/storage.interface';
import { WorkspaceService } from '../../workspace/workspace.service';

export type DeleteReason = 'NEVER_STORE' | 'AFTER_APPROVAL' | 'AFTER_DAYS' | 'MANUAL';

@Injectable()
export class AudioRetentionService {
  private readonly logger = new Logger(AudioRetentionService.name);

  constructor(
    @InjectRepository(AudioFile)
    private readonly audioRepo: Repository<AudioFile>,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
    private readonly workspace: WorkspaceService,
  ) {}

  /** Borra el archivo físico de storage y marca el registro como deleted_at. */
  async deleteAudioFile(audio: AudioFile, reason: DeleteReason): Promise<void> {
    if (audio.deletedAt) return; // ya fue borrado
    try {
      await this.storage.remove(audio.storageKey);
    } catch (e) {
      this.logger.warn(
        `No se pudo borrar archivo de storage "${audio.storageKey}": ${(e as Error).message}. Marcamos registro como borrado igualmente.`,
      );
    }
    await this.audioRepo.update(audio.id, {
      deletedAt: new Date(),
      deletedReason: reason,
    });
    this.logger.log(`Audio ${audio.id} borrado (reason=${reason}, meeting=${audio.meetingId})`);
  }

  /**
   * Llamar cuando una transcripción pasa a COMPLETED.
   * Si la política es NEVER_STORE, borra el audio inmediatamente.
   */
  async onTranscriptionCompleted(audioFileId: number): Promise<void> {
    const ws = await this.workspace.get().catch(() => null);
    if (ws?.audioRetentionPolicy !== 'NEVER_STORE') return;
    const audio = await this.audioRepo.findOne({ where: { id: audioFileId } });
    if (!audio || audio.deletedAt) return;
    await this.deleteAudioFile(audio, 'NEVER_STORE');
  }

  /**
   * Llamar cuando un acta pasa a APPROVED.
   * Si la política es DELETE_AFTER_APPROVAL, borra los audios de esa reunión.
   */
  async onActaApproved(meetingId: number): Promise<void> {
    const ws = await this.workspace.get().catch(() => null);
    if (ws?.audioRetentionPolicy !== 'DELETE_AFTER_APPROVAL') return;
    const audios = await this.audioRepo.find({
      where: { meetingId, deletedAt: IsNull() },
    });
    for (const a of audios) {
      await this.deleteAudioFile(a, 'AFTER_APPROVAL');
    }
  }

  /**
   * Cron diario a las 3 AM. Si la política es DELETE_AFTER_DAYS, borra los audios
   * con más de N días de antigüedad.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyRetentionCheck(): Promise<void> {
    const ws = await this.workspace.get().catch(() => null);
    if (!ws) return;
    if (ws.audioRetentionPolicy !== 'DELETE_AFTER_DAYS') return;

    const days = Math.max(1, ws.audioRetentionDays ?? 7);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const audios = await this.audioRepo.find({
      where: { createdAt: LessThan(cutoff), deletedAt: IsNull() },
    });

    this.logger.log(
      `Retención diaria: política=DELETE_AFTER_DAYS días=${days} candidatos=${audios.length}`,
    );

    for (const a of audios) {
      await this.deleteAudioFile(a, 'AFTER_DAYS');
    }
  }

  /**
   * Borrado manual (llamado desde endpoint admin). Sin chequeo de política.
   */
  async deleteByMeeting(meetingId: number): Promise<{ deleted: number }> {
    const audios = await this.audioRepo.find({
      where: { meetingId, deletedAt: IsNull() },
    });
    for (const a of audios) await this.deleteAudioFile(a, 'MANUAL');
    return { deleted: audios.length };
  }

  /** Count de archivos físicos aún presentes (para mostrar en dashboards). */
  async getStorageStats(): Promise<{ storedCount: number; deletedCount: number }> {
    const [storedCount, deletedCount] = await Promise.all([
      this.audioRepo.count({ where: { deletedAt: IsNull() } }),
      this.audioRepo.count({ where: { deletedAt: Not(IsNull()) } }),
    ]);
    return { storedCount, deletedCount };
  }
}
