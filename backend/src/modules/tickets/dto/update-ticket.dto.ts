import { PartialType } from '@nestjs/mapped-types';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { CreateTicketDto } from './create-ticket.dto';

/**
 * Update NO admite `status`, `priority` ni `assigneeUserId`: esos cambios pasan
 * obligatoriamente por los endpoints de transición, para que ninguno escape al
 * timeline ni a las reglas de la máquina de estados.
 */
export class UpdateTicketDto extends PartialType(CreateTicketDto) {
  @IsOptional() @IsString() descriptionMd?: string;
  @IsOptional() @IsArray() acceptanceCriteria?: string[];
  @IsOptional() @IsString() moduleName?: string;
  @IsOptional() @IsString() screenName?: string;
  @IsOptional() @IsString() flowContext?: string;
}
