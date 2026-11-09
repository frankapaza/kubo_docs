import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  TICKET_ORIGINS,
  TICKET_REQUEST_TYPES,
  SERVICE_CATEGORIES,
  TicketOrigin,
  TicketRequestType,
  ServiceCategory,
  isInternalTicketOrigin,
} from '../entities/ticket.entity';
import { TICKET_IMPACTS, TICKET_URGENCIES, TicketImpact, TicketUrgency } from '../domain/ticket-priority';

/**
 * Orígenes que el personal puede elegir a mano. Fuera quedan los internos
 * (`MONITOREO`): un ticket así es invisible para el cliente por decisión del
 * responsable, y abrirlo a mano escondería del portal una solicitud real. El
 * monitoreo crea los suyos llamando a `TicketsService.create` directamente,
 * sin pasar por este DTO ni por el `ValidationPipe`, así que no le afecta.
 */
export const MANUAL_TICKET_ORIGINS: readonly TicketOrigin[] = TICKET_ORIGINS.filter(
  (o) => !isInternalTicketOrigin(o),
);

/**
 * El alta de un ticket desde el panel (y la base de `UpdateTicketDto`).
 *
 * **No hay `projectId`.** El clasificador del soporte es el sistema; el
 * proyecto salió del ticket (decisión 11 del diseño). Con `forbidNonWhitelisted`
 * activo, mandarlo devuelve 400: una respuesta explícita, no un campo que se
 * ignora en silencio. La columna `tickets.project_id` sigue en la entidad a
 * propósito: el dato de los tickets viejos se conserva y `pushToJira` sigue
 * funcionando para ellos.
 */
export class CreateTicketDto {
  @IsString()
  @MinLength(1)
  rawText!: string;

  @IsOptional() @IsString() @MaxLength(240)
  subject?: string;

  @IsOptional()
  @IsIn(MANUAL_TICKET_ORIGINS as TicketOrigin[], {
    message: 'El origen elegido no se puede asignar a mano.',
  })
  origin?: TicketOrigin;

  @IsOptional() @IsIn(TICKET_REQUEST_TYPES)
  requestType?: TicketRequestType;

  @IsOptional() @IsIn(SERVICE_CATEGORIES)
  serviceCategory?: ServiceCategory;

  @IsOptional() @IsIn(TICKET_IMPACTS)
  impact?: TicketImpact;

  @IsOptional() @IsIn(TICKET_URGENCIES)
  urgency?: TicketUrgency;

  @IsOptional() @IsInt() @Min(1) clientId?: number;
  @IsOptional() @IsInt() @Min(1) systemId?: number;
  @IsOptional() @IsInt() @Min(1) meetingId?: number;

  @IsOptional() @IsDateString() capturedAt?: string;
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsInt() @Min(0) durationMinutes?: number;

  @IsOptional() @IsString() @MaxLength(255) rawAudioFilename?: string;
  @IsOptional() @IsArray() labels?: string[];
}
