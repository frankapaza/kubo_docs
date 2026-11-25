import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min, MinLength } from 'class-validator';

import { DEV_LINK_KINDS, DevLinkKind } from '../entities/dev-link.entity';

export class CreateDevRepoDto {
  @IsInt()
  @Min(1)
  clientSystemId!: number;

  /** `owner/repo` o la URL de GitHub; el servicio lo normaliza. */
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  githubFullName!: string;
}

export class UpdateDevRepoDto {
  @IsBoolean()
  isActive!: boolean;
}

export class CreateDevKeyDto {
  @IsInt()
  @Min(1)
  devRepoId!: number;
}

export class DevNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  texto!: string;
}

export class DevStatusDto {
  @IsString()
  @MaxLength(30)
  estado!: string;
}

export class DevLinkDto {
  @IsIn(DEV_LINK_KINDS)
  kind!: DevLinkKind;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  ref!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  url?: string;
}

export class DevResolveDto {
  @IsString() @MinLength(1) @MaxLength(20_000)
  solucion!: string;

  @IsString() @MinLength(1) @MaxLength(5_000)
  causaRaiz!: string;

  @IsString() @MinLength(1) @MaxLength(5_000)
  accionCorrectiva!: string;
}

/** Entregar un requerimiento a PRUEBAS: evidencia y manual de usuario (Markdown). */
export class DevDeliverDto {
  @IsString() @MinLength(1) @MaxLength(20_000)
  solucion!: string;

  @IsString() @MinLength(1) @MaxLength(10_000)
  comoProbar!: string;

  @IsString() @MinLength(1) @MaxLength(60_000)
  manual!: string;
}
