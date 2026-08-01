import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateWorkItemDto } from './create-work-item.dto';

/**
 * No admite `status`, `boardOrder` ni `priority`: cada uno tiene su endpoint y
 * cada uno escribe su evento. En T1 el update() de tickets recalculaba la
 * prioridad sin dejar rastro y hubo que corregirlo en la revisión de rama.
 *
 * `priority` se omite explícitamente de la base heredada; `status` y
 * `boardOrder` nunca estuvieron en CreateWorkItemDto.
 */
export class UpdateWorkItemDto extends PartialType(
  OmitType(CreateWorkItemDto, ['priority'] as const),
) {}
