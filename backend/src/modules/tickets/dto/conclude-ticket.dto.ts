import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Concluir un ticket ya atendido con una observación general (cierre en lote). */
export class ConcludeTicketDto {
  @IsString() @MinLength(3) @MaxLength(5000)
  solucion!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  rootCause?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  correctiveAction?: string;
}
