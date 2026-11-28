import { IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Firma en el iPad: participante existente, o nombre y DNI del asistente; trazo PNG. */
export class SignInPersonDto {
  @IsOptional() @IsInt() @Min(1)
  participantId?: number;

  @IsOptional() @IsString() @MaxLength(180)
  signerName?: string;

  @IsOptional() @IsString() @MaxLength(40)
  signerDocument?: string;

  @IsOptional() @IsString() @MaxLength(80)
  signerRole?: string;

  /** data:image/png;base64,… (≤ 300 KB decodificado; lo valida el servicio). */
  @IsString() @MaxLength(450_000)
  signaturePng!: string;
}

/** Firma por correo (EMAIL) o con trazo y correo (BOTH). */
export class SignByEmailDto {
  @IsIn(['EMAIL', 'BOTH', 'REMOTE'])
  mode!: 'EMAIL' | 'BOTH' | 'REMOTE';

  @IsOptional() @IsInt() @Min(1)
  participantId?: number;

  @IsOptional() @IsString() @MaxLength(180)
  signerName?: string;

  @IsOptional() @IsString() @MaxLength(40)
  signerDocument?: string;

  @IsOptional() @IsString() @MaxLength(80)
  signerRole?: string;

  @IsOptional() @IsEmail() @MaxLength(180)
  signerEmail?: string;

  /** Obligatorio con BOTH. */
  @IsOptional() @IsString() @MaxLength(450_000)
  signaturePng?: string;
}
