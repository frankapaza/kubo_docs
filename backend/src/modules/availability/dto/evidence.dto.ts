import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export const EVIDENCE_ORIGINS = ['OFICINA', 'SERVIDOR', 'OTRO'] as const;

/** Campos de texto del multipart de evidencia (el archivo va aparte, en `file`). */
export class UploadEvidenceDto {
  @IsIn(EVIDENCE_ORIGINS as unknown as string[])
  origin!: (typeof EVIDENCE_ORIGINS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsISO8601()
  capturedAt?: string;
}
