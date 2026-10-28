import { createHmac } from 'crypto';

import { PERU_TIME_ZONE } from '../../../common/time-zone';
import { MAX_BULK_ROWS, MAX_EMAIL_LENGTH, MAX_FULL_NAME_LENGTH } from './bulk-user-file';

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

/**
 * Lo más que puede ocupar UNA fila dentro del JSON del bloque, en bytes, en el
 * peor caso imaginable:
 *
 *  - 48 bytes de andamiaje: `{"line":202,"fullName":"","email":""},`, con sitio
 *    de sobra para un número de fila de cuatro cifras.
 *  - El nombre y el correo, hasta `MAX_*_LENGTH` **caracteres** cada uno y
 *    hasta 4 **bytes** por carácter: el JSON va en UTF-8 y no se escapa a
 *    `\uXXXX`, así que un nombre entero de caracteres fuera del plano básico es
 *    el techo. El escape de una comilla o una barra cuesta 2 bytes, menos que
 *    eso.
 */
const MAX_REVIEW_ROW_BYTES = 48 + 4 * (MAX_FULL_NAME_LENGTH + MAX_EMAIL_LENGTH);

/** `{"v":1,"clientId":123456,"issuedAt":1761700000000,"rows":[]}` y un poco más. */
const MAX_REVIEW_ENVELOPE_BYTES = 96;

/**
 * Lo más que puede medir la cadena del bloque, **derivado y no elegido**: el
 * archivo admite `MAX_BULK_ROWS` filas, así que el bloque que las aprueba todas
 * tiene un tamaño máximo que se puede calcular, y de ese sale el tope de la
 * validación del cuerpo (`ConfirmBulkInviteDto`) y el del analizador de JSON de
 * la ruta de envío.
 *
 * Que sea derivado es lo que importa: el número anterior (200 000) era un
 * redondeo a ojo que se quedaba CORTO para 200 filas con nombres y correos
 * largos, y el cuerpo chocaba contra el analizador de express antes de llegar a
 * ninguna valla nuestra. Si mañana sube el tope de filas o el de los nombres,
 * este sube solo.
 *
 * Base64url: cuatro caracteres por cada tres bytes.
 */
export const MAX_REVISION_LENGTH =
  Math.ceil((MAX_REVIEW_ENVELOPE_BYTES + MAX_BULK_ROWS * MAX_REVIEW_ROW_BYTES) / 3) * 4;

/**
 * Lo que el analizador de JSON admite en `POST /client-users/carga-masiva/envio`.
 *
 * El de express trae 100 KB por defecto, y rechaza **antes** de que la petición
 * llegue a ningún guarda, pipe o controlador: una revisión legítima de 200
 * filas ronda esa cifra, así que el tope que esta funcionalidad anuncia moría
 * en su propio extremo. Aquí cabe el cuerpo entero del peor caso
 * (`MAX_REVISION_LENGTH` + la firma + las comillas) con holgura, y sigue siendo
 * irrelevante para la memoria del proceso.
 *
 * Que sea un tope PROPIO de esta ruta y no el global es deliberado: ninguna otra
 * ruta del producto tiene por qué admitir medio megabyte de JSON.
 */
export const BULK_SEND_JSON_LIMIT_BYTES = 768 * 1024;

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
 *
 * **Lleva el día cuando la media hora cruza la medianoche**, y solo entonces.
 * A las 23:50, «vale hasta las 00:20» a secas se lee como una hora que ya pasó
 * —la de esta misma mañana— y empuja a volver a subir el archivo sin necesidad.
 * El resto del tiempo la fecha sobra: la revisión dura media hora, y escribirla
 * siempre sería ruido en el 99 % de los casos.
 */
export function reviewExpiryLabel(issuedAt: number): string {
  const caduca = new Date(issuedAt + REVIEW_TTL_MS);
  // Un instante ilegible imprimiría `Invalid Date`, en inglés y a un operador.
  if (Number.isNaN(caduca.getTime())) return 'una hora que no se puede determinar';

  const hora = caduca.toLocaleTimeString('es-PE', {
    timeZone: PERU_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  // El día SE COMPARA en hora de Lima, igual que se escribe: con la del proceso
  // (UTC en producción) la medianoche se cruzaría cinco horas antes de tiempo.
  const diaDeCaducidad = diaDeLima(caduca);
  if (diaDeLima(new Date(issuedAt)) === diaDeCaducidad) return hora;

  // Se escribe a partir de la MISMA cadena con la que se ha comparado, en vez
  // de pedirle otro formato a ICU: así no hay dos lecturas del calendario que
  // puedan decir días distintos, y el día y el mes salen siempre con sus dos
  // cifras (ICU, en `es-PE` y para un formato de solo día y mes, se come el
  // cero de delante y escribe «11/9»).
  const [, mes, dia] = diaDeCaducidad.split('-');
  return `${hora} del ${dia}/${mes}`;
}

/** El día civil de Lima, en una cadena ordenable y comparable (`2026-09-10`). */
function diaDeLima(instante: Date): string {
  return instante.toLocaleDateString('en-CA', { timeZone: PERU_TIME_ZONE });
}
