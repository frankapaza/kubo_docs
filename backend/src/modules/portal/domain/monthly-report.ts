import { PERU_TIME_ZONE } from '../../../common/time-zone';

/**
 * Tres valores, no dos.
 *
 * `SIN_COMPROMISO` no es un adorno: es la diferencia entre «no cumplimos» y
 * «no habíamos prometido nada». Colapsarlo en cualquiera de los otros dos
 * miente, y es la forma que toma en este informe el defecto que más veces ha
 * reaparecido en el proyecto: decidir por la ausencia de un valor en lugar de
 * por el hecho que lo determina.
 */
export type Compliance = 'CUMPLIDO' | 'INCUMPLIDO' | 'SIN_COMPROMISO';

/**
 * Veredicto sobre un plazo con hora — los dos del SLA de un ticket.
 *
 * `dueAt` ya viene con las pausas absorbidas: `SlaService` desplaza el
 * vencimiento al reanudar un ticket que estuvo en espera del cliente. Restar
 * aquí el tiempo en pausa lo descontaría dos veces.
 *
 * `periodEnd` existe para juzgar lo que quedó sin hacer: en un mes ya cerrado
 * no hay «pendiente de juicio». Si el plazo venció y nadie lo atendió, es
 * incumplido, y da igual que se atienda mañana.
 */
export function judgeDeadline(
  dueAt: Date | null,
  doneAt: Date | null,
  periodEnd: Date,
): Compliance {
  if (!dueAt) return 'SIN_COMPROMISO';
  if (doneAt) return doneAt.getTime() <= dueAt.getTime() ? 'CUMPLIDO' : 'INCUMPLIDO';
  return dueAt.getTime() < periodEnd.getTime() ? 'INCUMPLIDO' : 'SIN_COMPROMISO';
}

/** Fecha civil `YYYY-MM-DD` de un instante, en hora de Perú. */
function peruCivilDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PERU_TIME_ZONE }).format(instant);
}

/**
 * Veredicto sobre una fecha comprometida — la de un requerimiento.
 *
 * Se compara **por fecha civil y no por instante**, porque lo que se le
 * prometió al cliente fue un día entero: entregar a las 22:00 de ese día
 * cumple. Comparar instantes convertiría la promesa en «antes de medianoche
 * UTC», que son las 19:00 en Lima y nadie prometió eso.
 */
export function judgeCommitment(
  committedDate: string | null,
  deliveredAt: Date | null,
  periodEnd: Date,
): Compliance {
  if (!committedDate) return 'SIN_COMPROMISO';
  if (deliveredAt) {
    return peruCivilDate(deliveredAt) <= committedDate ? 'CUMPLIDO' : 'INCUMPLIDO';
  }
  return committedDate < peruCivilDate(periodEnd) ? 'INCUMPLIDO' : 'SIN_COMPROMISO';
}

/**
 * Porcentaje de cumplimiento, o `null` si no hubo nada que medir.
 *
 * Los `SIN_COMPROMISO` **se excluyen del denominador**. Meterlos abajo
 * castigaría al proveedor por trabajo sobre el que nunca se pactó un plazo, y
 * el número dejaría de significar lo que su etiqueta dice.
 *
 * Devuelve `null` y no `0` cuando no hay denominador: un cero se lee como «no
 * cumplieron nada», y lo cierto es «no había nada que cumplir». Quien pinte
 * esto debe escribir un guion, no un número.
 */
export function compliancePercent(items: Compliance[]): number | null {
  const medibles = items.filter((c) => c !== 'SIN_COMPROMISO');
  if (medibles.length === 0) return null;
  const cumplidos = medibles.filter((c) => c === 'CUMPLIDO').length;
  return Math.round((cumplidos / medibles.length) * 100);
}
