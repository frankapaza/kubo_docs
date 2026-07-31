import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { CreateTicketDto } from './create-ticket.dto';

/**
 * Update NO admite `status`, `priority` ni `assigneeUserId`: esos cambios pasan
 * obligatoriamente por los endpoints de transición, para que ninguno escape al
 * timeline ni a las reglas de la máquina de estados.
 *
 * Por el mismo motivo tampoco admite `impact` ni `urgency`: recalculan la
 * prioridad (ver `derivePriority`), y el único camino que deja rastro en el
 * timeline es `POST /tickets/:id/priority`, que además emite
 * `PRIORITY_OVERRIDDEN`. Si algún día hace falta editarlos desde aquí, hay
 * que escribirlos dentro de una transacción que también grabe ese evento —
 * ver `TicketAssignmentService.overridePriority()`.
 */
export class UpdateTicketDto extends PartialType(
  OmitType(CreateTicketDto, ['impact', 'urgency'] as const),
) {
  @IsOptional() @IsString() descriptionMd?: string;
  @IsOptional() @IsArray() acceptanceCriteria?: string[];
  @IsOptional() @IsString() moduleName?: string;
  @IsOptional() @IsString() screenName?: string;
  @IsOptional() @IsString() flowContext?: string;
}
