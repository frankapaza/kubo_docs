import { IsInt, IsOptional, Min } from 'class-validator';

/** `POST /tickets/:id/client`: el cliente nuevo, su sistema y quién recibe los avisos. */
export class ChangeTicketClientDto {
  @IsInt() @Min(1)
  clientId!: number;

  @IsOptional() @IsInt() @Min(1)
  systemId?: number | null;

  @IsOptional() @IsInt() @Min(1)
  clientUserId?: number | null;
}
