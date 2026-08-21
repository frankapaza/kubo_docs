import { BadRequestException } from '@nestjs/common';

/**
 * Desfase fijo de Perú respecto a UTC, en minutos.
 *
 * Perú no aplica horario de verano desde 1994, así que el desfase es
 * constante y se puede escribir. Es lo que permite calcular las fronteras de
 * un mes con aritmética simple, sin arrastrar una librería de zonas.
 *
 * El supuesto no se da por bueno a ciegas: `peru-month.spec.ts` lo verifica
 * contra los datos de zonas del sistema en cuatro meses del año. Si el día de
 * mañana dejara de ser cierto, esa prueba se pone roja — que es infinitamente
 * mejor que un informe desplazado cinco horas que nadie nota.
 */
export const PERU_UTC_OFFSET_MINUTES = -300;

const MINUTO = 60_000;

/**
 * Instante UTC en el que empieza y termina un mes **civil peruano**.
 *
 * Intervalo `[from, to)`: incluye el primer instante del mes y excluye el
 * primero del siguiente. Media noche pertenece al día que empieza, no al que
 * acaba, y así ningún registro cae en dos meses ni en ninguno.
 *
 * Producción corre en UTC, así que hacer esto con `new Date(year, month, 1)`
 * —que usa la zona del proceso— metería en septiembre todo lo ocurrido en
 * Lima después de las 19:00 del 31 de agosto.
 */
export function peruMonthBounds(year: number, month: number): { from: Date; to: Date } {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'El mes debe estar entre 1 y 12.',
    });
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'El año del informe no es válido.',
    });
  }

  // `Date.UTC` con el mes 12 rueda solo al enero siguiente, así que el cambio
  // de año no necesita un caso aparte.
  const inicioCivil = Date.UTC(year, month - 1, 1);
  const siguienteCivil = Date.UTC(year, month, 1);

  // Restar el desfase convierte la medianoche civil de Lima en su instante UTC:
  // 00:00 en Lima (UTC-5) son las 05:00 UTC.
  return {
    from: new Date(inicioCivil - PERU_UTC_OFFSET_MINUTES * MINUTO),
    to: new Date(siguienteCivil - PERU_UTC_OFFSET_MINUTES * MINUTO),
  };
}

/**
 * Si el mes ya terminó del todo en hora de Perú.
 *
 * Se compara contra el final del intervalo, no contra el mes en curso del
 * calendario: así el mes en curso y cualquiera futuro dan lo mismo —falso— sin
 * necesitar dos comprobaciones distintas.
 */
export function isPeruMonthClosed(year: number, month: number, now: Date): boolean {
  return now.getTime() >= peruMonthBounds(year, month).to.getTime();
}
