import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';

import { detectDocMime, zipEntryNames } from '../../work-items/domain/work-item-docs';

/**
 * Los archivos de un entregable: además de PDF, Word e imágenes (lo que ya
 * aceptan los documentos de un requerimiento), un cronograma llega en Excel o
 * en MS Project y una presentación de capacitación en PowerPoint.
 *
 * El tipo se decide por los bytes. El .mpp es un contenedor OLE, la misma
 * firma que un .doc o un .xls antiguos, así que ahí sí cuenta además la
 * extensión: un OLE solo se acepta si se llama «.mpp».
 */

export const MAX_DELIVERABLE_BYTES = 20 * 1024 * 1024;
export const DELIVERABLE_UPLOAD_LIMITS = { fileSize: MAX_DELIVERABLE_BYTES } as const;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const MPP_MIME = 'application/vnd.ms-project';

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  [XLSX_MIME]: 'xlsx',
  [PPTX_MIME]: 'pptx',
  [MPP_MIME]: 'mpp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export function detectDeliverableMime(buffer: Buffer, filename: string): string | null {
  const doc = detectDocMime(buffer);
  if (doc) return doc;
  const names = zipEntryNames(buffer);
  if (names && names.includes('[Content_Types].xml')) {
    if (names.includes('xl/workbook.xml')) return XLSX_MIME;
    if (names.includes('ppt/presentation.xml')) return PPTX_MIME;
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(OLE_MAGIC) && /\.mpp$/i.test(filename.trim())) {
    return MPP_MIME;
  }
  return null;
}

export function deliverableExtension(mime: string): string {
  return EXT[mime] ?? 'bin';
}

export function assertDeliverableFile(buffer: Buffer, filename: string): { mimeType: string; ext: string } {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException({ code: 'BAD_INPUT', message: 'El archivo está vacío.' });
  }
  if (buffer.length > MAX_DELIVERABLE_BYTES) {
    throw new PayloadTooLargeException({
      code: 'PAYLOAD_TOO_LARGE',
      message: `El archivo supera el máximo de ${MAX_DELIVERABLE_BYTES / (1024 * 1024)} MB.`,
    });
  }
  const mimeType = detectDeliverableMime(buffer, filename);
  if (!mimeType) {
    throw new UnsupportedMediaTypeException({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Se admiten PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), MS Project (.mpp) e imágenes.',
    });
  }
  return { mimeType, ext: deliverableExtension(mimeType) };
}
