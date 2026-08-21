import { IsDateString, IsIn, Matches } from 'class-validator';
import { WORK_ITEM_PRIORITIES, WorkItemPriority } from '../domain/work-item-board';

/**
 * Todos los mensajes van en español, igual que en `create-portal-requirement.dto.ts`:
 * sin `message` en el decorador, el `ValidationPipe` global deja pasar el
 * literal de class-validator tal cual —inglés y con el nombre interno de la
 * propiedad dentro—, que es justo lo que `portal-validation.integration.spec.ts`
 * prohíbe con sus listas negras.
 */
export class AcceptWorkItemDto {
  @IsIn(WORK_ITEM_PRIORITIES, { message: 'La prioridad no es válida.' })
  priority!: WorkItemPriority;

  /**
   * Fecha comprometida, `YYYY-MM-DD`. **Obligatoria**: es lo único que
   * garantiza que `due_date` esté relleno, y de ella depende el informe
   * mensual que el cliente descargará. Hoy el campo es opcional y nadie lo
   * rellena.
   *
   * `@Matches` va antes que `@IsDateString`: éste acepta una fecha con hora
   * (`2026-09-30T10:00:00Z`) porque valida ISO 8601 en general, no solo la
   * forma `date`. Esa fecha iría a una columna `date` y MySQL le recortaría
   * la hora en silencio. `@Matches` cierra esa puerta exigiendo el formato
   * exacto; `@IsDateString({ strict: true })` se queda para rechazar fechas
   * de calendario imposibles («2026-02-30»).
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha comprometida debe tener el formato AAAA-MM-DD.',
  })
  @IsDateString({ strict: true }, { message: 'La fecha comprometida no es una fecha válida.' })
  committedDate!: string;
}
