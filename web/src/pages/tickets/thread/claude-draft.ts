/**
 * Borradores de respuesta que deja Claude por el conector (`borrador_respuesta`
 * del MCP). Llegan como nota INTERNA con esta cabecera; el texto para el
 * cliente es lo que va después de la primera línea `---`.
 *
 * Copia de `BORRADOR_CABECERA`/`BORRADOR_SEPARADOR` de
 * `backend/src/modules/dev-connector/dev-api.service.ts` (el frontend no
 * importa del backend): si cambia allí, cambia aquí.
 */
const CABECERA = '**Borrador de respuesta al cliente**';
const SEPARADOR = /\r?\n---\r?\n/;

/** El texto propuesto para el cliente, o `null` si el mensaje no es un borrador de Claude. */
export function claudeDraftText(message: { visibility: string; bodyMd: string }): string | null {
  if (message.visibility !== 'INTERNA' || !message.bodyMd.startsWith(CABECERA)) return null;
  const partes = message.bodyMd.split(SEPARADOR);
  if (partes.length < 2) return null;
  const texto = partes.slice(1).join('\n---\n').trim();
  return texto || null;
}
