import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Ventana de mantenimiento nueva. Aquí solo se validan los tipos: las reglas
 * (exactamente uno de servidor o servicio, fechas, duración y motivo) las
 * aplica el servicio con 400 `BAD_INPUT`.
 */
export class CreateMaintenanceDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  serverId?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  serviceId?: number;

  @IsString()
  startsAt!: string;

  @IsString()
  endsAt!: string;

  @IsString()
  reason!: string;
}
