/**
 * Contrato para proveedores de transcripción.
 * Implementaciones: WhisperApiProvider (OpenAI), WhisperLocalProvider (whisper.cpp).
 */
export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  language: string | null;
  segments: TranscriptionSegment[];
}

export interface ITranscriptionProvider {
  transcribe(stream: NodeJS.ReadableStream, mimeType: string): Promise<TranscriptionResult>;
}

export const TRANSCRIPTION_PROVIDER = Symbol('ITranscriptionProvider');
