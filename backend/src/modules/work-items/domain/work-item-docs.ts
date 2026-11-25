import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { inflateRawSync } from 'zlib';

import { detectMimeType } from '../../ticket-messages/domain/attachment-rules';

/**
 * Documentos de un requerimiento: la Especificación con la que se acepta, el
 * Manual de usuario con el que se entrega y el Acta de conformidad con la que
 * se cierra. Dominio puro: sin base de datos ni disco.
 */
export type WorkItemDocKind = 'ESPECIFICACION' | 'MANUAL_USUARIO' | 'ACTA_CONFORMIDAD' | 'OTRO';

export const WORK_ITEM_DOC_KINDS: WorkItemDocKind[] = ['ESPECIFICACION', 'MANUAL_USUARIO', 'ACTA_CONFORMIDAD', 'OTRO'];

export const WORK_ITEM_DOC_KIND_LABELS: Record<WorkItemDocKind, string> = {
  ESPECIFICACION: 'Especificación del requerimiento',
  MANUAL_USUARIO: 'Manual de usuario',
  ACTA_CONFORMIDAD: 'Acta de conformidad',
  OTRO: 'Otro',
};

/**
 * `BORRADOR`: lo dejó Claude y nadie lo revisó todavía. `VIGENTE`: lo subió o
 * lo aprobó una persona. Mismo criterio que el borrador de respuesta de los
 * tickets: nada escrito por Claude pasa por bueno sin que alguien lo lea.
 */
export type WorkItemDocStatus = 'BORRADOR' | 'VIGENTE';

export const WORK_ITEM_DOC_STATUSES: WorkItemDocStatus[] = ['BORRADOR', 'VIGENTE'];

export type WorkItemDocSource = 'WEB' | 'CLAUDE';

export const WORK_ITEM_DOC_SOURCES: WorkItemDocSource[] = ['WEB', 'CLAUDE'];

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type DocMimeType =
  | typeof DOCX_MIME
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif';

export const DOC_EXTENSIONS: Record<DocMimeType, string> = {
  [DOCX_MIME]: 'docx',
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Una especificación con capturas pesa más que un adjunto de ticket. */
export const MAX_DOC_BYTES = 15 * 1024 * 1024;

export const DOC_UPLOAD_LIMITS = { fileSize: MAX_DOC_BYTES } as const;

/** Tope al descomprimir una entrada del ZIP: corta una «bomba zip» antes de llenar la memoria. */
const MAX_INFLATED_BYTES = 40 * 1024 * 1024;

/**
 * El tipo real del archivo, por sus bytes. Un Word es un ZIP, así que la firma
 * `PK` no basta: además tiene que traer `word/document.xml`, que es lo que
 * distingue un .docx de un .xlsx, un .pptx o un ZIP cualquiera. El .doc
 * antiguo (binario OLE) no se admite: no se puede leer sin una librería.
 */
export function detectDocMime(buffer: Buffer): DocMimeType | null {
  const basic = detectMimeType(buffer);
  if (basic) return basic;
  const names = zipEntryNames(buffer);
  if (names && names.includes('word/document.xml') && names.includes('[Content_Types].xml')) return DOCX_MIME;
  return null;
}

export function assertDocAcceptable(buffer: Buffer): DocMimeType {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException({ code: 'BAD_INPUT', message: 'El archivo está vacío.' });
  }
  if (buffer.length > MAX_DOC_BYTES) {
    throw new PayloadTooLargeException({
      code: 'PAYLOAD_TOO_LARGE',
      message: `El archivo supera el máximo de ${MAX_DOC_BYTES / (1024 * 1024)} MB.`,
    });
  }
  const mime = detectDocMime(buffer);
  if (!mime) {
    throw new UnsupportedMediaTypeException({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Solo se admiten documentos PDF o Word (.docx) e imágenes (PNG, JPG, WebP, GIF).',
    });
  }
  return mime;
}

/**
 * El texto de un .docx, para que Claude lo lea: un párrafo por línea y las
 * celdas de una tabla separadas por « | ». `null` si no es un Word legible.
 */
export function docxText(buffer: Buffer): string | null {
  const xml = readZipEntry(buffer, 'word/document.xml');
  if (!xml) return null;
  const text = xml
    .toString('utf8')
    // Dentro de una celda, un fin de párrafo no parte la fila de la tabla.
    .replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => cell.replace(/<\/w:p>/g, ' '))
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  return text
    .split('\n')
    .map((l) => l.replace(/ +\| /g, ' | ').replace(/(\s*\|\s*)+$/, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** Las entradas del directorio central de un ZIP, o `null` si no es un ZIP legible. */
function zipEntries(buf: Buffer): ZipEntry[] | null {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return null;
  // El fin del directorio central está en los últimos 22 bytes + un comentario de hasta 64 KB.
  const min = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    if (p + 46 + nameLen > buf.length) return null;
    entries.push({
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      localOffset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function zipEntryNames(buf: Buffer): string[] | null {
  try {
    return zipEntries(buf)?.map((e) => e.name) ?? null;
  } catch {
    return null;
  }
}

function readZipEntry(buf: Buffer, name: string): Buffer | null {
  try {
    const e = zipEntries(buf)?.find((x) => x.name === name);
    if (!e) return null;
    const h = e.localOffset;
    if (h + 30 > buf.length || buf.readUInt32LE(h) !== 0x04034b50) return null;
    const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
    const data = buf.subarray(start, start + e.compressedSize);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_INFLATED_BYTES });
    return null;
  } catch {
    return null;
  }
}
