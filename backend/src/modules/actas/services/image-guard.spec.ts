import { assertImageDimensions } from './image-guard';

function pngHeader(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

describe('assertImageDimensions', () => {
  it('acepta un PNG razonable y rechaza uno gigante (bomba de descompresión)', () => {
    expect(() => assertImageDimensions(pngHeader(1200, 400), 4000)).not.toThrow();
    expect(() => assertImageDimensions(pngHeader(20000, 20000), 4000)).toThrow();
  });
  it('un PNG sin cabecera IHDR válida se rechaza', () => {
    expect(() => assertImageDimensions(Buffer.from('89504e470d0a1a0a', 'hex'), 4000)).toThrow();
  });
  it('un JPEG no se decodifica (se incrusta tal cual): pasa', () => {
    expect(() => assertImageDimensions(Buffer.from('ffd8ffe000104a464946', 'hex'), 4000)).not.toThrow();
  });
});
