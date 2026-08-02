import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  AUDIO_RETENTION_POLICIES,
  AudioRetentionPolicy,
} from '../entities/workspace-setting.entity';

export class UpdateWorkspaceSettingsDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  razonSocial?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/, { message: 'RUC debe tener 11 dígitos' })
  ruc?: string;

  @IsOptional()
  @IsString()
  @Length(0, 180)
  legalRepName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  legalRepDoc?: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(0, 30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(0, 180)
  website?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  logoUrl?: string;

  // Sesión: minutos de inactividad antes de cerrar sesión. 0 = nunca.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  sessionTimeoutMinutes?: number;

  // SMTP
  @IsOptional()
  @IsString()
  @Length(0, 255)
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsOptional()
  @IsBoolean()
  smtpSecure?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  smtpUser?: string;

  // Se envía en texto plano, el service se encarga de encriptar.
  @IsOptional()
  @IsString()
  @Length(0, 500)
  smtpPass?: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  smtpFrom?: string;

  // Buzón del equipo para los avisos de tickets. Cadena vacía = limpiarlo, y
  // entonces los avisos internos caen al remitente SMTP; por eso `IsString` y
  // no `IsEmail`, que rechazaría el vaciado.
  @IsOptional()
  @IsString()
  @Length(0, 180)
  teamInboxEmail?: string;

  // Retención de audio
  @IsOptional()
  @IsEnum(AUDIO_RETENTION_POLICIES)
  audioRetentionPolicy?: AudioRetentionPolicy;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  audioRetentionDays?: number;
}
