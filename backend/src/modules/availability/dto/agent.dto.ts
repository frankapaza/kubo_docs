import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const MAX_AGENT_DISKS = 26;
export const MAX_AGENT_IIS_POOLS = 200;
export const MAX_AGENT_SERVICES = 50;
export const MAX_AGENT_NAME = 256;
/** Tope de cada contador del Visor de eventos: la suma cabe en un INT con holgura. */
export const MAX_AGENT_EVENT_ERRORS = 1_000_000_000;

export class AgentDiskDto {
  @IsString() @MinLength(1) @MaxLength(MAX_AGENT_NAME)
  name!: string;

  @IsInt() @Min(0)
  totalBytes!: number;

  @IsInt() @Min(0)
  freeBytes!: number;
}

export class AgentIisPoolDto {
  @IsString() @MinLength(1) @MaxLength(MAX_AGENT_NAME)
  name!: string;

  @IsString() @MaxLength(64)
  state!: string;
}

export class AgentServiceDto {
  @IsString() @MinLength(1) @MaxLength(MAX_AGENT_NAME)
  name!: string;

  @IsString() @MaxLength(64)
  status!: string;
}

export class AgentEventErrorsDto {
  @IsInt() @Min(0) @Max(MAX_AGENT_EVENT_ERRORS)
  system!: number;

  @IsInt() @Min(0) @Max(MAX_AGENT_EVENT_ERRORS)
  application!: number;
}

/** `POST /ingest/probe/agent/samples`: una muestra del agente (contrato de la Task 10). */
export class AgentSampleDto {
  @IsString() @MinLength(1) @MaxLength(40)
  agentVersion!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(100)
  cpuPct!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(100)
  ramPct!: number;

  @IsArray() @ArrayMaxSize(MAX_AGENT_DISKS) @ValidateNested({ each: true }) @Type(() => AgentDiskDto)
  disks!: AgentDiskDto[];

  /** null si el servidor no tiene IIS. */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_AGENT_IIS_POOLS) @ValidateNested({ each: true }) @Type(() => AgentIisPoolDto)
  iisPools!: AgentIisPoolDto[] | null;

  @IsArray() @ArrayMaxSize(MAX_AGENT_SERVICES) @ValidateNested({ each: true }) @Type(() => AgentServiceDto)
  services!: AgentServiceDto[];

  @IsObject() @ValidateNested() @Type(() => AgentEventErrorsDto)
  eventErrors!: AgentEventErrorsDto;
}

export interface AgentSampleResponse {
  watchServices: string[];
  intervalSeconds: number;
}
