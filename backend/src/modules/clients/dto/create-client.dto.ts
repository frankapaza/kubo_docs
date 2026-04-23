import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { CLIENT_STATUSES, ClientStatus } from '../entities/client.entity';

export class CreateClientDto {
  @IsString()
  @Length(2, 200)
  razonSocial!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/, { message: 'RUC debe tener 11 dígitos numéricos' })
  ruc?: string;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  @Matches(/^[A-Z0-9]+$/, { message: 'El código Jira debe ser letras mayúsculas o números (ej. CE, CE2)' })
  jiraCode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 180)
  legalRepName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  legalRepDoc?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @Length(1, 180)
  contactEmail?: string;

  @IsOptional()
  @IsEnum(CLIENT_STATUSES)
  status?: ClientStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}
