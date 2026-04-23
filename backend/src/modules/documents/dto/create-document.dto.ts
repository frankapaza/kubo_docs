import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class CreateDocumentDto {
  @IsInt()
  @Min(1)
  clientId!: number;

  @IsInt()
  @Min(1)
  templateId!: number;

  @IsString()
  @Length(2, 250)
  title!: string;

  @IsObject()
  variables!: Record<string, string | number | null>;

  @IsOptional()
  @IsInt()
  @Min(1)
  meetingId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  projectId?: number;
}
