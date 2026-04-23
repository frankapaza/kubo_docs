import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import {
  COMMERCIAL_DOCUMENT_STATUSES,
  CommercialDocumentStatus,
} from '../entities/commercial-document.entity';

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @Length(2, 250)
  title?: string;

  @IsOptional()
  @IsString()
  contentMarkdown?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string | number | null>;

  @IsOptional()
  @IsEnum(COMMERCIAL_DOCUMENT_STATUSES)
  status?: CommercialDocumentStatus;
}
