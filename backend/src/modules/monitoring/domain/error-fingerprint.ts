import { createHash } from 'crypto';

/**
 * Espacios de nombres de terceros: un marco de pila que empieza así no dice
 * qué código PROPIO falló, así que no sirve para identificar el error.
 */
export const FRAMEWORK_PREFIXES: readonly string[] = [
  'System.',
  'Microsoft.',
  'log4net.',
  'Newtonsoft.',
  'Dapper.',
  'Oracle.',
  'MySql.',
  'Npgsql.',
  'RestSharp.',
  'Owin.',
  'Castle.',
  'Autofac.',
  'NHibernate.',
  'EntityFramework',
  'lambda_method',
];

const MAX_NORMALIZED = 500;
const MAX_TITLE_MESSAGE = 200;
/**
 * Topes contra entrada hostil: un marco con miles de espacios haría
 * cuadráticas las expresiones de limpieza, y 1000 eventos así frenarían la
 * ingesta. Un marco real cabe de sobra en 1000 caracteres.
 */
const MAX_FRAME_LINE_CHARS = 1000;
const MAX_FRAMES = 200;

/**
 * Quita del mensaje lo que cambia entre ocurrencias del MISMO error (ids,
 * fechas, rutas) para que se agrupen. El orden importa: una fecha contiene
 * números y una ruta contiene de todo, así que lo más específico va primero.
 */
export function normalizeMessage(msg: string): string {
  return msg
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<guid>')
    .replace(
      /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
      '<fecha>',
    )
    .replace(
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s?m\.?)?)?/gi,
      '<fecha>',
    )
    .replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, '<hora>')
    .replace(/[A-Za-z]:\\[^\s"'<>|?*]*/g, '<ruta>')
    .replace(/\\\\[^\s"'<>|]+/g, '<ruta>')
    .replace(/(?<![\w<])(?:\/[\w.\-@~]+){2,}\/?/g, '<ruta>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b\d+(?:[.,]\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NORMALIZED);
}

/** `<>c__DisplayClass5_0` y `b__3_0` cambian entre compilaciones: se les quitan los dígitos. */
function normalizeFrame(frame: string): string {
  return frame.replace(/(__[A-Za-z]*)\d+(?:_\d+)*/g, '$1<n>').trim();
}

/**
 * Extrae el tipo de la excepción exterior y los marcos de pila.
 *
 * Entiende el texto en inglés (`at ... in X:line N`) y en español
 * (`en ... en X:línea N`) porque el idioma lo decide el Windows del cliente.
 * Los marcos salen sin ruta ni número de línea: cambian con cada despliegue
 * y partirían el mismo error en grupos distintos.
 */
export function parseException(text: string | null): { type: string | null; frames: string[] } {
  if (!text) return { type: null, frames: [] };
  const lines = text.split(/\r?\n/);
  const header = (lines.find((l) => l.trim() !== '') ?? '').trim();
  // Con `---> ` interna manda la exterior: la interna es la causa, no el error visible.
  const outer = header.split(' ---> ')[0];
  const m = /^([A-Za-z_][\w.+`]*)\s*(?::|$)/.exec(outer);
  const type = m ? m[1] : null;

  const frames: string[] = [];
  for (const rawLine of lines) {
    if (frames.length >= MAX_FRAMES) break;
    const line = rawLine.slice(0, MAX_FRAME_LINE_CHARS);
    const f = /^\s*(?:at|en)\s+(.+\(.*)$/.exec(line);
    if (!f) continue;
    const limpio = f[1]
      .replace(/\s+(?:in|en)\s+.*?:\s*(?:line|línea|linea)\s+\d+\s*$/i, '')
      .replace(/\s+(?:in|en)\s+(?:[A-Za-z]:\\|\\\\|\/).*$/, '');
    frames.push(normalizeFrame(limpio));
  }
  return { type, frames };
}

/** Primer marco que no es de framework: el código propio más cercano al fallo. */
export function firstOwnFrame(frames: string[]): string | null {
  return frames.find((f) => !FRAMEWORK_PREFIXES.some((p) => f.startsWith(p))) ?? null;
}

/**
 * Huella estable de un error: la misma falla da la misma huella aunque
 * cambien ids, fechas o líneas de código; otro cliente, sistema o aplicativo
 * da otra (los errores se atienden por cliente).
 *
 * Sin pila legible, el `logger` sustituye al marco propio. Con pila pero sin
 * marco propio no se usa el logger a propósito: la pila ya identifica.
 */
export function computeErrorFingerprint(i: {
  clienteKey: string;
  sistemaKey: string;
  aplicativo: string;
  logger: string;
  mensaje: string;
  excepcion: string | null;
}): { fingerprint: string; exceptionType: string | null; title: string } {
  const { type, frames } = parseException(i.excepcion);
  const own = firstOwnFrame(frames);
  const fingerprint = createHash('sha256')
    .update(
      [
        i.clienteKey,
        i.sistemaKey,
        i.aplicativo,
        type ?? '',
        normalizeMessage(i.mensaje),
        own ?? (i.excepcion ? '' : i.logger),
      ].join('\n'),
    )
    .digest('hex');

  const primera = (i.mensaje.split(/\r?\n/)[0] ?? '').trim().slice(0, MAX_TITLE_MESSAGE);
  const title = type ? (primera ? `${type}: ${primera}` : type) : primera || i.logger;
  return { fingerprint, exceptionType: type, title };
}
