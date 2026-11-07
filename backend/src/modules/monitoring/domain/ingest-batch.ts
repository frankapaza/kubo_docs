import { LogLevel, normalizeLevel } from './log-level';

/** Límites del contrato de recepción; appender y backend comparten estos números. */
export const MAX_EVENTS_PER_BATCH = 1000;
export const MAX_BATCH_BYTES = 2 * 1024 * 1024;
export const MAX_TEXT_CHARS = 32768;
export const MAX_LABEL_CHARS = 100;
export const MAX_PROPERTIES = 50;
export const MAX_PROPERTY_CHARS = 1024;

/** Longitudes de las columnas VARCHAR de error_groups / error_occurrences. */
const MAX_LOGGER_CHARS = 255;
const MAX_THREAD_CHARS = 100;
const MAX_VERSION_CHARS = 50;
const MAX_BATCH_ID_CHARS = 100;

export interface IngestEvent {
  /** Sin validar: `resolveEventTime` decide qué hacer con él. */
  ts: unknown;
  nivel: LogLevel;
  logger: string;
  mensaje: string;
  excepcion: string | null;
  hilo: string | null;
  propiedades: Record<string, string>;
}

export interface IngestBatch {
  loteId: string | null;
  aplicativo: string;
  servidor: string;
  appenderVersion: string | null;
  descartados: number;
  eventos: IngestEvent[];
}

/**
 * Recorta por caracteres sin partir un par sustituto UTF-16: cortar entre
 * las dos mitades de un emoji dejaría una mitad suelta que MySQL (utf8mb4)
 * rechaza o corrompe.
 */
export function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return s.slice(0, end);
}

/**
 * Las etiquetas (aplicativo, servidor, logger, hilo) acaban en etiquetas de
 * Loki, en líneas de log y en columnas de texto: un salto de línea o un
 * control dentro permitiría falsear líneas o romper el formato.
 */
function cleanLabel(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return truncateText(raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim(), max);
}

function optionalText(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  return truncateText(raw, MAX_TEXT_CHARS);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseProperties(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(raw)) return out;
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (count >= MAX_PROPERTIES) break;
    // `__proto__` como clave reasignaría el prototipo del objeto de salida.
    if (k === '' || k === '__proto__') continue;
    let valor: string;
    if (v === null) valor = '';
    else if (typeof v === 'string') valor = v;
    else if (typeof v === 'number' || typeof v === 'boolean') valor = String(v);
    else continue; // objetos y arreglos: no caben en una etiqueta plana
    out[truncateText(k, MAX_PROPERTY_CHARS)] = truncateText(valor, MAX_PROPERTY_CHARS);
    count += 1;
  }
  return out;
}

function parseEvent(raw: Record<string, unknown>): IngestEvent {
  const mensaje =
    typeof raw.mensaje === 'string'
      ? raw.mensaje
      : typeof raw.mensaje === 'number' || typeof raw.mensaje === 'boolean'
        ? String(raw.mensaje)
        : '';
  const hilo = cleanLabel(raw.hilo, MAX_THREAD_CHARS);
  return {
    ts: raw.ts,
    nivel: normalizeLevel(raw.nivel),
    logger: cleanLabel(raw.logger, MAX_LOGGER_CHARS),
    mensaje: truncateText(mensaje, MAX_TEXT_CHARS),
    excepcion: optionalText(raw.excepcion),
    hilo: hilo === '' ? null : hilo,
    propiedades: parseProperties(raw.propiedades),
  };
}

/**
 * Valida y sanea el cuerpo de `POST /ingest/logs`.
 *
 * Tolerante a propósito: ignora campos desconocidos y acota en vez de
 * rechazar (salvo lo estructural), porque un 4xx haría que el appender
 * reintentara el mismo lote sin fin. Los elementos de `eventos` que no son
 * objetos se omiten.
 */
export function parseIngestBatch(
  raw: unknown,
): { ok: true; batch: IngestBatch } | { ok: false; message: string } {
  if (!isRecord(raw)) return { ok: false, message: 'El cuerpo debe ser un objeto JSON' };

  const aplicativo = cleanLabel(raw.aplicativo, MAX_LABEL_CHARS);
  if (aplicativo === '') return { ok: false, message: 'Falta "aplicativo"' };
  const servidor = cleanLabel(raw.servidor, MAX_LABEL_CHARS);
  if (servidor === '') return { ok: false, message: 'Falta "servidor"' };

  if (!Array.isArray(raw.eventos)) return { ok: false, message: '"eventos" debe ser un arreglo' };
  if (raw.eventos.length > MAX_EVENTS_PER_BATCH) {
    return { ok: false, message: `Un lote admite como máximo ${MAX_EVENTS_PER_BATCH} eventos` };
  }

  const loteId = cleanLabel(raw.loteId, MAX_BATCH_ID_CHARS);
  const version = cleanLabel(raw.appenderVersion, MAX_VERSION_CHARS);
  const descartados =
    typeof raw.descartados === 'number' && Number.isFinite(raw.descartados) && raw.descartados > 0
      ? Math.floor(raw.descartados)
      : 0;

  return {
    ok: true,
    batch: {
      loteId: loteId === '' ? null : loteId,
      aplicativo,
      servidor,
      appenderVersion: version === '' ? null : version,
      descartados,
      eventos: raw.eventos.filter(isRecord).map(parseEvent),
    },
  };
}
