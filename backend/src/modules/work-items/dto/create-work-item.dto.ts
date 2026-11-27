import {
  IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength,
} from 'class-validator';
import { WORK_ITEM_PRIORITIES, WorkItemPriority } from '../domain/work-item-board';
import { WORK_ITEM_REQUEST_TYPES, WorkItemRequestType } from '../entities/work-item.entity';

/**
 * El alta de un requerimiento (y la base de `UpdateWorkItemDto`).
 *
 * **No hay `projectId`**: el proyecto salió del circuito de soporte (decisión
 * 11 del diseño). Con `forbidNonWhitelisted`, mandarlo devuelve 400 en vez de
 * ignorarse. La columna `work_items.project_id` y sus datos se quedan.
 */
export class CreateWorkItemDto {
  @IsInt() @Min(1)
  clientId!: number;

  /** Asignación cliente-sistema (conector de Claude). Opcional. */
  @IsOptional() @IsInt() @Min(1)
  clientSystemId?: number;

  @IsString() @MinLength(1) @MaxLength(240)
  title!: string;

  @IsOptional() @IsString()
  descriptionMd?: string;

  @IsOptional() @IsArray()
  acceptanceCriteria?: string[];

  @IsOptional() @IsArray()
  labels?: string[];

  /** CAMBIO a un sistema existente o PROYECTO nuevo / prototipo. */
  @IsOptional() @IsIn(WORK_ITEM_REQUEST_TYPES)
  requestType?: WorkItemRequestType;

  @IsOptional() @IsIn(WORK_ITEM_PRIORITIES)
  priority?: WorkItemPriority;

  @IsOptional() @IsInt() @Min(1)
  assigneeUserId?: number;

  /** Objetivo del equipo, no un SLA. Formato YYYY-MM-DD. */
  @IsOptional() @IsDateString()
  dueDate?: string;
}
