import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TranscriptionsService } from './transcriptions.service';

interface TranscribeJobData {
  transcriptionId: number;
}

@Processor('transcription')
export class TranscriptionProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscriptionProcessor.name);

  constructor(private readonly service: TranscriptionsService) {
    super();
  }

  async process(job: Job<TranscribeJobData>): Promise<void> {
    this.logger.log(`[job ${job.id}] transcribiendo transcription=${job.data.transcriptionId}`);
    await this.service.process(job.data.transcriptionId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(`[job ${job.id}] falló: ${err.message}`);
  }
}
