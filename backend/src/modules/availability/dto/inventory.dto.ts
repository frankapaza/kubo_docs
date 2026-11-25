import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

/** Servicios de Windows que puede vigilar el agente de un servidor. */
export const MAX_AGENT_WATCH_SERVICES = 50;

export const ENTITY_STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export type EntityStatusValue = (typeof ENTITY_STATUSES)[number];

export class CreateServerDto {
  @Type(() => Number) @IsInt() @Min(1)
  clientId!: number;

  @IsString() @MinLength(1) @MaxLength(150)
  name!: string;

  @IsString() @MinLength(1) @MaxLength(255)
  host!: string;

  @IsOptional() @IsString() @MaxLength(80)
  role?: string;

  @IsOptional() @IsString() @MaxLength(80)
  provider?: string;

  @IsOptional() @IsString() @MaxLength(80)
  region?: string;
}

export class UpdateServerDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(150)
  name?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(255)
  host?: string;

  @IsOptional() @IsString() @MaxLength(80)
  role?: string;

  @IsOptional() @IsString() @MaxLength(80)
  provider?: string;

  @IsOptional() @IsString() @MaxLength(80)
  region?: string;

  @IsOptional() @IsEnum(ENTITY_STATUSES)
  status?: EntityStatusValue;

  /** Servicios de Windows que vigila el agente (nombre corto, p. ej. `W3SVC`); null los quita todos. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_AGENT_WATCH_SERVICES)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(256, { each: true })
  @Matches(/^[A-Za-z0-9_.\- ]+$/, { each: true })
  agentWatchServices?: string[] | null;
}

export class CreateServiceDto {
  @Type(() => Number) @IsInt() @Min(1)
  serverId!: number;

  /** `client_systems.id`; debe pertenecer al cliente del servidor. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  systemId?: number;

  @IsString() @MinLength(1) @MaxLength(150)
  name!: string;

  @IsEnum(['TCP', 'HTTPS', 'ICMP'])
  protocol!: 'TCP' | 'HTTPS' | 'ICMP';

  @IsString() @MinLength(1) @MaxLength(255)
  target!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535)
  port?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(600000)
  latencyThresholdMs?: number;

  @IsOptional() @IsEnum(['HIGH', 'MEDIUM', 'LOW'])
  criticality?: 'HIGH' | 'MEDIUM' | 'LOW';
}

export class UpdateServiceDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  systemId?: number;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(150)
  name?: string;

  @IsOptional() @IsEnum(['TCP', 'HTTPS', 'ICMP'])
  protocol?: 'TCP' | 'HTTPS' | 'ICMP';

  @IsOptional() @IsString() @MinLength(1) @MaxLength(255)
  target?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535)
  port?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(600000)
  latencyThresholdMs?: number;

  @IsOptional() @IsEnum(['HIGH', 'MEDIUM', 'LOW'])
  criticality?: 'HIGH' | 'MEDIUM' | 'LOW';

  @IsOptional() @IsEnum(ENTITY_STATUSES)
  status?: EntityStatusValue;
}

export class TestServiceDto {
  @Type(() => Number) @IsInt() @Min(1)
  serviceId!: number;
}
