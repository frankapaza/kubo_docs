import { createHmac } from 'crypto';

import { PERU_TIME_ZONE } from '../../../common/time-zone';
import { MAX_BULK_ROWS } from './bulk-user-file';

/**
 * Lo que hace que **no se pueda confirmar una cosa distinta de la que se
 * revisó** (decisión 15 de la spec).
 *
 * Dominio puro: no consulta la base, no manda correo y **no lee el reloj**. El
 * instante actual entra siempre por argumento, igual que
 * `domain/invitation-secret.ts`. Que no lea el reloj es lo que permite probar
 * la caducidad sin esperar media hora y, sobre todo, sin que el resultado
 * dependa de la zona del proceso: producción corre en UTC y el host de
 * desarrollo en América/Lima.
 *
 * **Esto NO es una credencial.** El bloque firmado no da acceso a nada: solo
 * autentica un dato que quien lo tiene ya tiene entero, y la ruta que lo recibe
 * exige sesión, personal de la casa y rol ADMIN igual que si no existiera. Por
 * eso su campo se llama `mac` y no cae bajo el patrón de tachado de la
 * auditoría, y por eso conviene que quede legible en el asiento: es lo que
 * permite reconstruir qué revisión se confirmó. El día que alguien quiera que
 * valga por sí solo para hacer algo sin sesión, pasa a ser una credencial y
 * tiene que cambiar de nombre para que el patrón la tache.
 */

/**
 * Lo que vale una revisión: media hora.
 *
 * Es más de lo que se tarda en leer 22 filas y menos de lo que se tarda en
 * olvidarse de una pestaña abierta. Es un número elegido, no derivado.
 */
export const REVIEW_TTL_MS = 30 * 60 * 1000;

/**
 * Versión del bloque. Va **dentro de lo firmado**: si mañana cambia la forma,
 * un bloque viejo no se interpreta con las reglas nuevas — se rechaza, y quien
 * lo tenga vuelve a subir el archivo.
 */
export const REVIEW_VERSION = 1;

/** Etiqueta de separación de dominio de la clave: la distingue de la firma de los tokens. */
export const REVIEW_KEY_DOMAIN_LABEL = 'kubo:carga-masiva-usuarios:v1';

/** Una fila aprobada en la revisión. El correo ya viene normalizado. */
export interface ReviewRow {
  /** Número de fila en el archivo, para poder señalarla en el informe final. */
  line: number;
  fullName: string;
  email: string;
}

export interface ReviewPayload {
  v: number;
  /** La empresa. Va DENTRO de lo firmado, y la confirmación no acepta ninguna otra. */
  clientId: number;
  /** Instante absoluto en milisegundos de época. Nunca una fecha civil. */
  issuedAt: number;
  rows: ReviewRow[];
}

/**
 * La clave del MAC, derivada de `JWT_ACCESS_SECRET`.
 *
 * **Derivada, no el secreto tal cual.** `JwtSecretsValidator` ya obliga a que
 * ese secreto exista y a que no sea un valor de ejemplo en producción, así que
 * apoyarse en él evita una variable de entorno nueva y un secreto más que
 * rotar. Pero usarlo directamente haría que este uso y la firma de los tokens
 * compartieran material de clave; la etiqueta de separación de dominio lo
 * impide, y cuesta una línea.
 *
 * **Sin secreto no hay clave.** HMAC acepta una clave vacía sin protestar, y
 * firmar con una clave que cualquiera conoce es peor que no firmar: parece
 * protegido. Por eso lanza en vez de derivar.
 */
export function deriveReviewKey(secret: string): Buffer {
  if (typeof secret !== 'string' || secret === '') {
    throw new Error('No se puede firmar la revisión: falta el secreto del servidor.');
  }
  return createHmac('sha256', secret).update(REVIEW_KEY_DOMAIN_LABEL).digest();
}

/** El bloque, listo para viajar en un JSON y volver verbatim. */
export function encodeReview(payload: ReviewPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * El MAC **de la cadena del bloque, tal cual llega**.
 *
 * Sobre la cadena y no sobre el objeto reconstruido, y ahí está toda la
 * robustez: no hay ninguna canonicalización que acordar entre las dos puntas,
 * así que no hay ninguna forma de que un `JSON.stringify` con las claves en
 * otro orden rompa la firma por sorpresa. Se verifica **antes** de decodificar.
 *
 * Para compararlo con el que llega, `invitationFingerprintsMatch` de
 * `invitation-secret.ts`: una sola decisión de comparación en tiempo constante,
 * no una copia. Aquí sí importa que lo sea, a diferencia de las huellas: lo que
 * el cliente controla es el MAC mismo, sin hash intermedio.
 */
export function reviewMac(key: Buffer, blob: string): string {
  return createHmac('sha256', key).update(blob, 'utf8').digest('hex');
}

/**
 * El bloque decodificado, o `null` si no tiene EXACTAMENTE la forma esperada.
 *
 * `null` y no una excepción: quien llama ya tiene un cuerpo de error para «esta
 * revisión no vale», y las dos causas —firma mala y forma mala— tienen que
 * salir por el mismo sitio.
 *
 * Se comprueba campo a campo y no con un `as`: este valor viene del cuerpo de
 * una petición, y que el MAC case solo dice que lo firmamos nosotros, no que un
 * despliegue anterior no firmara otra forma.
 */
export function decodeReview(blob: string): ReviewPayload | null {
  let crudo: unknown;
  try {
    crudo = JSON.parse(Buffer.from(blob, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return null;
  const p = crudo as Record<string, unknown>;

  if (p.v !== REVIEW_VERSION) return null;
  if (typeof p.clientId !== 'number' || !Number.isInteger(p.clientId) || p.clientId <= 0) {
    return null;
  }
  if (typeof p.issuedAt !== 'number' || !Number.isFinite(p.issuedAt)) return null;
  // El mismo tope que el lector del archivo: así no depende de que quien
  // confirme se acuerde de comprobarlo.
  if (!Array.isArray(p.rows) || p.rows.length === 0 || p.rows.length > MAX_BULK_ROWS) {
    return null;
  }

  const rows: ReviewRow[] = [];
  for (const fila of p.rows) {
    if (!fila || typeof fila !== 'object') return null;
    const f = fila as Record<string, unknown>;
    if (typeof f.line !== 'number' || !Number.isInteger(f.line) || f.line < 1) return null;
    if (typeof f.fullName !== 'string' || f.fullName.trim() === '') return null;
    if (typeof f.email !== 'string' || f.email.trim() === '') return null;
    rows.push({ line: f.line, fullName: f.fullName, email: f.email });
  }

  return { v: p.v, clientId: p.clientId, issuedAt: p.issuedAt, rows };
}

/**
 * Si esa revisión ya no vale.
 *
 * Aritmética sobre milisegundos absolutos, nunca `setMinutes`/`getHours`, que
 * leen la zona del proceso.
 *
 * **Falla cerrado en los tres frentes**, igual que `isInvitationExpired`:
 *  1. Emisión ilegible → caducada. Un `NaN` comparado sin guarda cede hacia
 *     «todavía vale», que es la dirección equivocada.
 *  2. Reloj ilegible → caducada. Que no se pueda leer la hora no abre puertas.
 *  3. **Emisión en el futuro → caducada.** Un bloque con un `issuedAt` por
 *     delante del reloj no es una revisión joven: es un reloj que se movió o
 *     una firma de otro despliegue, y en los dos casos lo que corresponde es
 *     volver a subir el archivo.
 */
export function isReviewExpired(issuedAt: unknown, now: Date): boolean {
  const ahora = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(ahora)) return true;

  const emitida = typeof issuedAt === 'number' ? issuedAt : Number.NaN;
  if (!Number.isFinite(emitida)) return true;
  if (emitida > ahora) return true;

  return ahora - emitida >= REVIEW_TTL_MS;
}

/**
 * Hasta cuándo vale, en hora de Lima y escrito para leerse.
 *
 * `timeZone: PERU_TIME_ZONE` **explícito**, nunca `toLocaleTimeString` a secas:
 * producción corre en UTC y quien lee esto está en Lima. Es el mismo fallo que
 * ya mordió en los correos de tickets, y por eso su prueba compara contra la
 * hora exacta.
 *
 * `hourCycle: 'h23'` y no `hour12: false`: este último, según la versión de
 * ICU, escribe la medianoche como `24:10`.
 */
export function reviewExpiryLabel(issuedAt: number): string {
  const caduca = new Date(issuedAt + REVIEW_TTL_MS);
  // Un instante ilegible imprimiría `Invalid Date`, en inglés y a un operador.
  if (Number.isNaN(caduca.getTime())) return 'una hora que no se puede determinar';
  return caduca.toLocaleTimeString('es-PE', {
    timeZone: PERU_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
