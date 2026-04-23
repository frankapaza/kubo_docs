import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ITranscriptionProvider,
  TranscriptionResult,
} from '../interfaces/transcription-provider.interface';

@Injectable()
export class WhisperTranscriptionProvider implements ITranscriptionProvider {
  private readonly logger = new Logger(WhisperTranscriptionProvider.name);

  constructor(private readonly cfg: ConfigService) {}

  async transcribe(
    stream: NodeJS.ReadableStream,
    mimeType: string,
  ): Promise<TranscriptionResult> {
    const apiKey = this.cfg.get<string>('OPENAI_API_KEY');
    const baseUrl = this.cfg.get<string>(
      'WHISPER_API_BASE_URL',
      'https://api.groq.com/openai/v1',
    );
    const model = this.cfg.get<string>('WHISPER_MODEL', 'whisper-large-v3-turbo');
    const language = this.cfg.get<string>('WHISPER_LANGUAGE', 'es');

    if (!apiKey || apiKey.startsWith('sk-REPLACE')) {
      this.logger.warn('OPENAI_API_KEY no configurada — devolviendo transcripción dummy.');
      await new Promise((r) => setTimeout(r, 1500));
      return {
        text: '[TRANSCRIPCIÓN DUMMY] Integrar Whisper API real en WhisperTranscriptionProvider.',
        language: 'es',
        segments: [
          { start: 0, end: 3, text: '[TRANSCRIPCIÓN DUMMY]' },
          { start: 3, end: 6, text: 'Integrar Whisper API real.' },
        ],
      };
    }

    const buffer = await streamToBuffer(stream);
    const ext = extFromMime(mimeType);
    const file = new Blob([new Uint8Array(buffer)], { type: mimeType });

    const form = new FormData();
    form.append('file', file, `audio.${ext}`);
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    if (language) form.append('language', language);

    const url = `${baseUrl.replace(/\/$/, '')}/audio/transcriptions`;
    this.logger.log(`Whisper → POST ${url} (model=${model}, ${buffer.length}B)`);

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Whisper API ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      text?: string;
      language?: string;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    return {
      text: (json.text ?? '').trim(),
      language: json.language ?? language ?? null,
      segments: (json.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
      })),
    };
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function extFromMime(mime: string): string {
  const clean = (mime || '').toLowerCase();
  if (clean.includes('m4a') || clean.includes('mp4') || clean.includes('aac')) return 'm4a';
  if (clean.includes('webm')) return 'webm';
  if (clean.includes('ogg')) return 'ogg';
  if (clean.includes('wav')) return 'wav';
  if (clean.includes('mpeg') || clean.includes('mp3')) return 'mp3';
  if (clean.includes('flac')) return 'flac';
  return 'm4a';
}
