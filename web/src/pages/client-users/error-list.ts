/**
 * Cuerpo de error de la API: `{ code, message }`, y en los 400 de validación
 * también `details` con un motivo por entrada. `message` es siempre una
 * cadena ya legible (el filtro del backend une la lista), así que `details`
 * solo se usa para poder desglosarla en viñetas cuando hay más de un motivo.
 * Mismo criterio que `NewPortalTicketDialog` (`web/src/pages/portal`), copiado
 * aquí porque las dos pantallas viven en árboles distintos del panel y no
 * conviene acoplarlas por un helper compartido.
 */
export function toErrorList(e: any): string[] {
  const data = e?.response?.data as { message?: string; details?: unknown } | undefined;

  if (Array.isArray(data?.details) && data.details.length > 0) {
    return data.details.map(String);
  }
  if (typeof data?.message === 'string' && data.message.length > 0) {
    return [data.message];
  }
  return ['No se pudo completar la operación. Inténtalo de nuevo.'];
}
