#!/usr/bin/env node
/**
 * Copia al frontend los tipos aceptados y los topes de los adjuntos, leyéndolos
 * del **único sitio donde se deciden**:
 * `backend/src/modules/ticket-messages/domain/attachment-rules.ts`.
 *
 * Por qué un generador y no un `import` directo:
 *
 * - El módulo del dominio importa `@nestjs/common` (lanza
 *   `UnsupportedMediaTypeException` y `PayloadTooLargeException`). Meterlo en el
 *   bundle del navegador arrastraría NestJS entero -- que además no está en las
 *   dependencias de `web/` -- así que `import` no es una opción.
 * - Tampoco se pueden pedir al backend en caliente: no hay ningún endpoint que
 *   publique estas constantes, y esta tarea no toca el backend.
 * - Escribirlas a mano es justo lo que no puede pasar: si divergen, la interfaz
 *   acepta ficheros que el servidor rechaza y el usuario se entera después de
 *   subir.
 *
 * De modo que el fichero generado **se versiona** (el `Dockerfile` de `web/` no
 * tiene acceso a `backend/`) y este script se ejecuta en dos modos:
 *
 *   node scripts/sync-attachment-rules.mjs            → reescribe el generado
 *   node scripts/sync-attachment-rules.mjs --check     → falla si está desfasado
 *
 * `--check` está enganchado a `prebuild`, con `--skip-if-missing` para que el
 * build de la imagen de `web/` --que solo copia `web/`, sin `backend/`-- no se
 * caiga por no poder comprobar algo que ya viene comprobado del repositorio.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '..');
const SOURCE = resolve(WEB_ROOT, '../backend/src/modules/ticket-messages/domain/attachment-rules.ts');
const TARGET = resolve(WEB_ROOT, 'src/api/attachment-rules.generated.ts');

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const skipIfMissing = args.has('--skip-if-missing');

if (!existsSync(SOURCE)) {
  if (skipIfMissing) {
    console.warn(
      `[attachment-rules] No se encuentra ${SOURCE}; se da por bueno el fichero ya generado.`,
    );
    process.exit(0);
  }
  fail(`No se encuentra la fuente de verdad: ${SOURCE}`);
}

/**
 * Se lee el fichero **sin sus comentarios**, y no es un detalle de limpieza.
 *
 * Una regla comentada es código que no existe: el backend no la aplica. Pero
 * para una expresión regular sigue siendo texto que casa, así que una línea
 * como `// Pendiente: { mimeType: 'image/svg+xml', … }` dejada dentro del
 * bloque de reglas se colaba **en la lista blanca del frontend** -- y encima el
 * SVG, que es justo el tipo que el dominio excluye a propósito por no tener
 * firma binaria y admitir `<script>` dentro. De todas las formas de romper esta
 * extracción es la única que pasaba en silencio: las demás (renombrar una
 * constante, cambiar la forma de la lista) fallan alto y paran el build.
 *
 * Se quitan de **todo** el fichero, no solo del bloque de reglas: el propio
 * comentario de cabecera menciona `MAX_FILE_BYTES` varias veces, y basta con
 * que alguien deje ahí un `export const MAX_FILE_BYTES = …` de ejemplo para que
 * la extracción del tope lea el ejemplo en vez del valor real.
 */
const source = stripComments(readFileSync(SOURCE, 'utf8'));

/**
 * Los tipos salen de `SIGNATURE_RULES` y no de `ALLOWED_TYPES`, por el mismo
 * motivo que el backend deriva la segunda de la primera: un tipo sin firma no
 * es detectable, así que la lista buena es la de las reglas.
 */
const rulesBlock = between(source, 'const SIGNATURE_RULES', '\n];');
const mimeTypes = [...rulesBlock.matchAll(/mimeType:\s*'([^']+)'/g)].map((m) => m[1]);
if (mimeTypes.length === 0) fail('No se pudo extraer ningún `mimeType` de `SIGNATURE_RULES`.');

const maxFileBytes = numericConstant(source, 'MAX_FILE_BYTES');
const maxTicketBytes = numericConstant(source, 'MAX_TICKET_BYTES');

const generated = render({ mimeTypes, maxFileBytes, maxTicketBytes });

if (checkOnly) {
  const current = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : '';
  if (normalize(current) !== normalize(generated)) {
    fail(
      'El fichero `src/api/attachment-rules.generated.ts` no coincide con el dominio del backend.\n' +
        'Ejecuta `npm run sync:attachment-rules` y revisa el resultado antes de compilar.',
    );
  }
  console.log('[attachment-rules] Al día con el dominio del backend.');
  process.exit(0);
}

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, generated, 'utf8');
console.log(
  `[attachment-rules] Escrito ${TARGET} (${mimeTypes.length} tipos, ` +
    `${maxFileBytes} B por archivo, ${maxTicketBytes} B por ticket).`,
);

// ---------------------------------------------------------------------------

/**
 * Quita los comentarios de bloque y los de línea, dejando los saltos de línea en
 * su sitio para que los mensajes de error sigan teniendo sentido.
 *
 * El `//` solo se reconoce al principio de la línea o precedido de un espacio,
 * de modo que no se coma el `//` de un `https://` ni la barra de un
 * `'image/png'`. No es un analizador de TypeScript --no hace falta serlo para
 * un fichero de constantes-- pero cubre las dos formas en las que alguien deja
 * una regla «para más adelante».
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/** El trozo de `text` entre el primer `start` y el `end` que le sigue. Falla si falta alguno. */
function between(text, start, end) {
  const from = text.indexOf(start);
  if (from === -1) fail(`No se encuentra «${start}» en el dominio del backend.`);
  const to = text.indexOf(end, from);
  if (to === -1) fail(`No se encuentra el cierre «${end}» tras «${start}».`);
  return text.slice(from, to);
}

/**
 * El valor de `export const <name> = <expresión aritmética>;`.
 *
 * La expresión se evalúa, pero solo después de comprobar que **únicamente**
 * lleva cifras, espacios y los operadores de una multiplicación con paréntesis:
 * el fichero de origen escribe los topes como `10 * 1024 * 1024`, y copiar el
 * número ya resuelto a mano volvería a abrir la puerta a la divergencia que
 * este script existe para cerrar.
 */
function numericConstant(text, name) {
  const match = new RegExp(`export const ${name}\\s*=\\s*([^;]+);`).exec(text);
  if (!match) fail(`No se encuentra la constante \`${name}\` en el dominio del backend.`);

  const expression = match[1].trim();
  if (!/^[\d\s*+()]+$/.test(expression)) {
    fail(`La constante \`${name}\` no es una expresión aritmética simple: «${expression}».`);
  }

  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${expression});`)();
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`La constante \`${name}\` no da un entero positivo: «${expression}» → ${value}.`);
  }
  return value;
}

function render({ mimeTypes, maxFileBytes, maxTicketBytes }) {
  const union = mimeTypes.map((type) => `  | '${type}'`).join('\n');
  const list = mimeTypes.map((type) => `  '${type}',`).join('\n');

  return `/**
 * GENERADO AUTOMÁTICAMENTE. No editar a mano.
 *
 * Fuente de verdad:
 *   backend/src/modules/ticket-messages/domain/attachment-rules.ts
 *
 * Para regenerarlo:  npm run sync:attachment-rules
 * Para comprobarlo:  npm run check:attachment-rules  (lo hace también \`prebuild\`)
 *
 * Estos valores no son una copia de conveniencia: son los mismos números y los
 * mismos tipos con los que \`assertAcceptable\` decide en el servidor. Si aquí
 * dijeran otra cosa, la interfaz aceptaría ficheros que el servidor rechaza y el
 * usuario se enteraría después de subirlos.
 */

/** Los tipos que el backend sabe reconocer por firma de bytes, y nada más. */
export type AllowedMimeType =
${union};

/** La lista, en el mismo orden en que el backend prueba las firmas. */
export const ALLOWED_MIME_TYPES: readonly AllowedMimeType[] = [
${list}
];

/** Tope por archivo, en bytes. El servidor mide el contenido real, nunca lo declarado. */
export const MAX_FILE_BYTES = ${maxFileBytes};

/**
 * Tope acumulado por ticket, en bytes, **contando solo lo que sube el cliente**.
 * El equipo no tiene tope. El frontend no puede anticipar este corte (no conoce
 * lo ya guardado): lo aplica el servidor y llega como \`CONFLICT\`.
 */
export const MAX_TICKET_BYTES = ${maxTicketBytes};

/** Lo que el navegador puede poner en el \`accept\` de un \`<input type="file">\`. */
export const ACCEPT_ATTRIBUTE = ALLOWED_MIME_TYPES.join(',');
`;
}

/** Compara ignorando el estilo de fin de línea: en Windows el fichero se escribe con CRLF. */
function normalize(text) {
  return text.replace(/\r\n/g, '\n').trimEnd();
}

function fail(message) {
  console.error(`[attachment-rules] ${message}`);
  process.exit(1);
}
