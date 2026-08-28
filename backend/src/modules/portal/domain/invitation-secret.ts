import { createHash, randomBytes } from 'crypto';

/**
 * El secreto de una invitación al portal, su huella y su caducidad.
 *
 * Dominio puro: no consulta la base, no manda correo y **no lee el reloj**.
 * El instante actual entra siempre por argumento, igual que los conteos en
 * `inbound-email/domain/throttle.ts`. Que no lea el reloj es lo que permite
 * probar la caducidad sin esperar siete días y, sobre todo, sin que el
 * resultado dependa de la zona del proceso: producción corre en UTC y el host
 * de desarrollo en América/Lima.
 */

/**
 * 32 bytes de fuente criptográfica. No un identificador secuencial, no una
 * marca de tiempo, no un identificador con formato adivinable: este valor es
 * lo único que separa a un desconocido de una credencial válida.
 */
export const INVITATION_SECRET_BYTES = 32;

/** Días que vive una invitación. */
export const INVITATION_TTL_DAYS = 7;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Un secreto nuevo, codificado para viajar dentro de una dirección web.
 *
 * `base64url` y no `hex`: mismos 32 bytes de entropía en 43 caracteres en vez
 * de 64, y sin ninguno de los tres caracteres (`+`, `/`, `=`) que obligarían a
 * escapar el enlace —un enlace que además va a pasar por clientes de correo
 * que reescriben URLs.
 */
export function generateInvitationSecret(): string {
  return randomBytes(INVITATION_SECRET_BYTES).toString('base64url');
}

/**
 * La huella del secreto: lo ÚNICO que se guarda en la base.
 *
 * SHA-256 a secas y no bcrypt, a diferencia de una contraseña. La razón no es
 * la comodidad: bcrypt existe para encarecer el ataque por diccionario contra
 * un valor que una persona eligió y que por tanto tiene poca entropía. Aquí el
 * valor son 256 bits de `randomBytes` —no hay diccionario que probar— y en
 * cambio sí hace falta poder BUSCAR por la huella con un índice único, cosa
 * que un hash con sal distinta por fila impide por construcción.
 *
 * Lo que sí comparte con bcrypt es lo que importa: no se puede deshacer. Quien
 * lea la base no obtiene ningún enlace utilizable.
 */
export function fingerprintInvitationSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** El instante en que caduca una invitación creada en `now`. */
export function invitationExpiryFrom(now: Date): Date {
  // Aritmética sobre milisegundos absolutos, nunca `setDate`/`getFullYear`:
  // esos leen la zona horaria del proceso y darían un instante distinto en
  // producción (UTC) y en el host de desarrollo (América/Lima).
  return new Date(now.getTime() + INVITATION_TTL_DAYS * MS_POR_DIA);
}

/**
 * Si esa invitación ya caducó, comparando dos instantes absolutos.
 *
 * El instante exacto de caducidad cuenta como caducado (`<=`): en la frontera,
 * la respuesta que no da acceso es la correcta.
 *
 * Una caducidad ilegible —cadena vacía, basura, `Invalid Date`— se trata como
 * CADUCADA. Fallo cerrado: una caducidad que no se puede interpretar no puede
 * significar «todavía sirve», que es justo la dirección en la que un `NaN`
 * cedería si se comparara sin guarda (`NaN <= x` es siempre `false`, o sea,
 * «no ha caducado»).
 */
export function isInvitationExpired(expiresAt: Date | string, now: Date): boolean {
  const instante = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (!Number.isFinite(instante)) return true;
  return instante <= now.getTime();
}
