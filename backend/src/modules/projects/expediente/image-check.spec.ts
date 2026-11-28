import { deflateSync } from 'zlib';

import { crc32 } from '../../../common/zip/zip-writer';
import { assertDecodablePng, isDecodablePng } from './image-check';

function png(w: number, h: number, colorType: number, idat: Buffer, depth = 8): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

describe('PNG decodificable (antes de que pdfkit lo lea)', () => {
  it('acepta un PNG RGBA correcto', () => {
    const raw = Buffer.alloc((4 * 4 + 1) * 3, 0);
    expect(() => assertDecodablePng(png(4, 3, 6, deflateSync(raw)))).not.toThrow();
  });

  it('rechaza un RGBA con datos basura (tumbaría el proceso al armar el PDF)', () => {
    const bad = png(4, 3, 6, Buffer.from('esto no es deflate'));
    expect(() => assertDecodablePng(bad)).toThrow(/imagen PNG está dañada/);
    expect(isDecodablePng(bad)).toBe(false);
  });

  it('rechaza datos incompletos, tipos de color inválidos y dimensiones excesivas', () => {
    expect(() => assertDecodablePng(png(4, 3, 6, deflateSync(Buffer.alloc(5))))).toThrow(/dañada/);
    expect(() => assertDecodablePng(png(4, 3, 5, deflateSync(Buffer.alloc(51))))).toThrow(/dañada/);
    expect(() => assertDecodablePng(png(5000, 10, 0, deflateSync(Buffer.alloc(10))))).toThrow(/4000/);
    expect(() => assertDecodablePng(Buffer.from('89504e470d0a1a0a', 'hex'))).toThrow(/dañada/);
  });
});
