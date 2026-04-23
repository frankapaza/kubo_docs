import { IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { AudioSource } from '../entities/audio-file.entity';

export class UploadAudioDto {
  @IsEnum(['WEB', 'MOBILE'])
  source!: AudioSource;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @IsString()
  @Length(64, 64)
  checksumSha256?: string;
}
