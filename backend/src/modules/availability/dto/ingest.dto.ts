import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const MAX_CHECKS_PER_BATCH = 500;
export const MAX_SIGNALS_PER_BATCH = 200;

const CHECK_KINDS = ['REGULAR', 'RETRY', 'MANUAL', 'CROSS'] as const;
const ERROR_CODES = ['TIMEOUT', 'REFUSED', 'DNS', 'TLS', 'HTTP_STATUS', 'NETWORK'] as const;
const SIGNAL_TYPES = [
  'VERIFYING',
  'CONFIRMED_FAILURE',
  'TRANSIENT_FAILURE',
  'RECOVERED',
  'DEGRADED',
  'DEGRADATION_CLEARED',
  'OFFICE_OUTAGE_START',
  'OFFICE_OUTAGE_END',
  'STATE_SYNC',
] as const;

export class CheckResultDto {
  @IsUUID('4') id!: string;
  @IsInt() @Min(1) serviceId!: number;
  @IsIn(CHECK_KINDS) kind!: (typeof CHECK_KINDS)[number];
  @IsISO8601({ strict: true }) cycleAt!: string;
  @IsISO8601({ strict: true }) startedAt!: string;
  @IsInt() @Min(0) @Max(2_147_483_647) durationMs!: number;
  @IsBoolean() ok!: boolean;
  @IsOptional() @IsIn(ERROR_CODES) errorCode!: (typeof ERROR_CODES)[number] | null;
  @IsOptional() @IsInt() @Min(0) @Max(999) httpStatus!: number | null;
  @IsOptional() @IsInt() @Min(1) orderId!: number | null;
}

export class ProbeSignalDto {
  @IsUUID('4') id!: string;
  @IsIn(SIGNAL_TYPES) type!: (typeof SIGNAL_TYPES)[number];
  @IsOptional() @IsInt() @Min(1) serviceId!: number | null;
  @IsISO8601({ strict: true }) at!: string;
  @IsOptional() @IsISO8601({ strict: true }) firstFailureAt!: string | null;
}

export class ProbeBatchDto {
  @IsArray() @ArrayMaxSize(MAX_CHECKS_PER_BATCH) @ValidateNested({ each: true }) @Type(() => CheckResultDto)
  checks!: CheckResultDto[];

  @IsArray() @ArrayMaxSize(MAX_SIGNALS_PER_BATCH) @ValidateNested({ each: true }) @Type(() => ProbeSignalDto)
  signals!: ProbeSignalDto[];

  @IsString() @MaxLength(40)
  version!: string;
}
