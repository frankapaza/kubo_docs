import { BadRequestException } from '@nestjs/common';

const PNG_MAGIC = '89504e470d0a1a0a';

/**
 * Rechaza un PNG de dimensiones absurdas antes de guardarlo: pdfkit lo descomprime
 * entero al armar el PDF, y uno pequeño en bytes pero de 20 000 × 20 000 px (bomba de
 * descompresión) bloquearía el servidor en cada descarga. Los JPEG se incrustan sin
 * decodificar, así que no corren ese riesgo.
 */
export function assertImageDimensions(buf: Buffer, maxSide: number): void {
  if (buf.subarray(0, 8).toString('hex') !== PNG_MAGIC) return;
  const valid = buf.length >= 24 && buf.subarray(12, 16).toString('latin1') === 'IHDR';
  const w = valid ? buf.readUInt32BE(16) : 0;
  const h = valid ? buf.readUInt32BE(20) : 0;
  if (!valid || w === 0 || h === 0 || w > maxSide || h > maxSide) {
    throw new BadRequestException({ code: 'BAD_INPUT', message: `La imagen no es válida o supera ${maxSide} px de lado.` });
  }
}
