import { IsInt, Min } from 'class-validator';

export class SignActaDto {
  @IsInt()
  @Min(1)
  participantId!: number;
}
