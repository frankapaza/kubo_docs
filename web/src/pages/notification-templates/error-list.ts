/**
 * Cuerpo de error de la API: `{ code, message }`. `message` es siempre una
 * cadena ya legible en español (incluye el 429 de `ApiThrottlerGuard` y el
 * 400 de `NotificationTemplatesService.assertValid`, que distingue variable
 * "del otro público" de variable "que no existe" dentro del propio texto).
 * Copiado de `web/src/pages/client-users/error-list.ts` en vez de compartido:
 * mismo criterio que allí, las dos pantallas viven en árboles distintos del
 * panel y no conviene acoplarlas por un helper común.
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
