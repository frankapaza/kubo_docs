import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ArchiveTicketDto {
  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}
