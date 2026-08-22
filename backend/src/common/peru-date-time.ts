import { PERU_TIME_ZONE } from './time-zone';

/**
 * Fecha y hora en español y en hora de Perú, con la zona escrita -- el
 * formateador único para "un instante en UTC, listo para que lo lea una
 * persona en Lima".
 *
 * **Ronda de correcciones final de la Task 9: unifica tres copias, dos de
 * ellas añadidas por ese mismo trabajo sin darse cuenta de que ya existía
 * una.** Antes de esto, `portal-reports.service.ts` tenía la suya (con
 * `dateStyle: 'long'`, para el PDF del reporte mensual) y, por separado,
 * `domain/retry.ts` e `inbound-email.controller.ts` tenían cada una la suya
 * propia -- idénticas entre sí (`dateStyle: 'medium'`, para la pantalla de
 * correo entrante), pero triplicando exactamente la misma llamada a
 * `Intl.DateTimeFormat`. El propio comentario de `PERU_TIME_ZONE` ya avisaba
 * de este riesgo para la zona horaria en sí ("no debe haber dos copias: la
 * que alguien olvide actualizar es la que vuelve a comparar contra la zona
 * del proceso") -- el mismo riesgo aplica letra por letra a la función que
 * la usa para formatear: la próxima copia que alguien añada sin buscar
 * primero si ya existe una es la que arriesga divergir (otro estilo de
 * fecha, otra zona, otro texto) del resto.
 *
 * `dateStyle` es el único eje en el que las tres copias diferían de verdad
 * -- `'long'` para un documento (el reporte mensual, donde el criterio
 * impreso merece la fecha completa) y `'medium'` para una pantalla de tabla
 * (donde el espacio es limitado). Parametrizarlo aquí, en vez de fijarlo, es
 * lo que permite unir las tres sin perder ese matiz; `'medium'` por omisión
 * porque es el que usan los dos consumidores nuevos.
 */
export function formatPeruDateTime(instant: Date, dateStyle: 'medium' | 'long' = 'medium'): string {
  const texto = new Intl.DateTimeFormat('es-PE', {
    dateStyle,
    timeStyle: 'short',
    timeZone: PERU_TIME_ZONE,
  }).format(instant);
  return `${texto} (hora de Perú)`;
}
