import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DOCUMENT_TYPES,
  DocumentType,
} from '../entities/document-template.entity';

class TemplateVariableDto {
  @IsString()
  @Length(1, 80)
  key!: string;

  @IsString()
  @Length(1, 200)
  label!: string;

  @IsIn(['text', 'longtext', 'number', 'date', 'email'])
  type!: 'text' | 'longtext' | 'number' | 'date' | 'email';

  @IsIn(['client', 'workspace', 'manual', 'auto', 'ai'])
  source!: 'client' | 'workspace' | 'manual' | 'auto' | 'ai';

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  defaultValue?: string | number;
}

class VariablesSchemaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateVariableDto)
  variables!: TemplateVariableDto[];
}

export class UpsertTemplateDto {
  @IsString()
  @Length(2, 200)
  name!: string;

  @IsEnum(DOCUMENT_TYPES)
  type!: DocumentType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @Length(10, 200000)
  contentMarkdown!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => VariablesSchemaDto)
  variablesSchema!: VariablesSchemaDto;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
