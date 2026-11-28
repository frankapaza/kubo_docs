import { BadRequestException } from '@nestjs/common';
import { inflateSync } from 'zlib';

/**
 * Un PNG que pdfkit pueda leer sin sorpresas. pdfkit decodifica los PNG con
 * transparencia mediante png-js, que descomprime en un callback y hace
 * `throw` si falla: ese error no lo atrapa ningún try/catch y tumba el
 * proceso. Por eso un PNG se descomprime entero al subirlo y se rechaza si
 * sus datos no cuadran con su cabecera.
 */

export const MAX_PNG_SIDE = 4000;

const SIGNATURE = '89504e470d0a1a0a';

/** Canales por tipo de color y profundidades válidas (PNG 1.2, tabla 11.1). */
const COLOR: Record<number, { channels: number; depths: number[] }> = {
  0: { channels: 1, depths: [1, 2, 4, 8, 16] },
  2: { channels: 3, depths: [8, 16] },
  3: { channels: 1, depths: [1, 2, 4, 8] },
  4: { channels: 2, depths: [8, 16] },
  6: { channels: 4, depths: [8, 16] },
};

function damaged(): never {
  throw new BadRequestException({ code: 'BAD_INPUT', message: 'La imagen PNG está dañada o no se puede leer.' });
}

/** Bytes que ocupan los datos descomprimidos de una imagen (o de una pasada de Adam7). */
function rawSize(w: number, h: number, bitsPerPixel: number): number {
  if (w === 0 || h === 0) return 0;
  return h * (1 + Math.ceil((w * bitsPerPixel) / 8));
}

export function assertDecodablePng(buf: Buffer): void {
  if (buf.length < 33 || buf.subarray(0, 8).toString('hex') !== SIGNATURE) damaged();
  let p = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat: Buffer[] = [];
  let first = true;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    if (p + 12 + len > buf.length) damaged();
    const data = buf.subarray(p + 8, p + 8 + len);
    if (first && type !== 'IHDR') damaged();
    first = false;
    if (type === 'IHDR') {
      if (len !== 13) damaged();
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + len;
  }
  const color = COLOR[colorType];
  if (!color || !color.depths.includes(depth) || interlace > 1 || !w || !h || !idat.length) damaged();
  if (w > MAX_PNG_SIDE || h > MAX_PNG_SIDE) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: `La imagen supera los ${MAX_PNG_SIDE} píxeles por lado. Redúcela antes de adjuntarla.`,
    });
  }
  const bpp = color.channels * depth;
  let expected = 0;
  if (interlace === 0) {
    expected = rawSize(w, h, bpp);
  } else {
    // Adam7: siete pasadas, cada una con su propio ancho y alto.
    const passes = [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2],
    ];
    for (const [x0, y0, dx, dy] of passes) {
      expected += rawSize(Math.ceil((w - x0) / dx), Math.ceil((h - y0) / dy), bpp);
    }
  }
  let out: Buffer;
  try {
    out = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
  } catch {
    damaged();
  }
  if (out.length !== expected) damaged();
}

export function isDecodablePng(buf: Buffer): boolean {
  try {
    assertDecodablePng(buf);
    return true;
  } catch {
    return false;
  }
}
