import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Entero opcional de query string, compatible con el `ValidationPipe` global.
 *
 * El pipe global corre antes que los de cada parámetro y, con `transform: true`,
 * convierte un parámetro `number` ausente en `NaN` y uno presente en número.
 * `ParseIntPipe({ optional: true })` no acepta ninguno de los dos (espera el
 * texto original), así que rechazaba con 400 cualquier llamada sin el filtro.
 * Este pipe acepta lo que llegue: ausente, vacío o `NaN` → `undefined`; un
 * entero (número o texto) → número; cualquier otra cosa → 400.
 *
 * Límite conocido: un texto no numérico («abc») llega ya como `NaN` desde el
 * pipe global y se trata como filtro ausente. Un decimal («1.5») sí da 400.
 */
@Injectable()
export class OptionalIntPipe implements PipeTransform<unknown, number | undefined> {
  transform(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return undefined;
      if (Number.isInteger(value)) return value;
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Validation failed (numeric string is expected)' });
  }
}
