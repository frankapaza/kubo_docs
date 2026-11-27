import { IsInt, IsOptional, Min } from 'class-validator';

/** `POST /work-items/:id/client`: el cliente nuevo, su sistema y quién recibe los avisos. */
export class ChangeWorkItemClientDto {
  @IsInt() @Min(1)
  clientId!: number;

  @IsOptional() @IsInt() @Min(1)
  clientSystemId?: number | null;

  @IsOptional() @IsInt() @Min(1)
  clientUserId?: number | null;
}
