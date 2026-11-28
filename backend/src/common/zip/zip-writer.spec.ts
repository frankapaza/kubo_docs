import { inflateRawSync } from 'zlib';

import { buildZip, crc32, safeZipPath } from './zip-writer';

/** Lee el directorio central como lo haría un descompresor. */
function readZip(buf: Buffer): Record<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    expect(buf.readUInt16LE(p + 8) & 0x0800).toBe(0x0800);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    expect(crc32(data)).toBe(crc);
    out[name] = data;
    p += 46 + nameLen;
  }
  return out;
}

describe('buildZip', () => {
  it('el CRC-32 coincide con el valor de referencia', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('guarda y recupera cada archivo, con nombres en UTF-8', () => {
    const texto = Buffer.from('índice;versión\n'.repeat(200), 'utf8');
    const binario = Buffer.from([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);
    const zip = buildZip([
      { name: 'Planificación/KUBO-COB-0002-CRO-PRO V1.0.pdf', data: binario },
      { name: 'indice.csv', data: texto },
    ]);
    const files = readZip(zip);
    expect(Object.keys(files)).toEqual(['Planificación/KUBO-COB-0002-CRO-PRO V1.0.pdf', 'indice.csv']);
    expect(files['indice.csv'].equals(texto)).toBe(true);
    expect(files['Planificación/KUBO-COB-0002-CRO-PRO V1.0.pdf'].equals(binario)).toBe(true);
    // El CSV repetitivo se comprime; el binario chico se guarda tal cual.
    expect(zip.length).toBeLessThan(texto.length);
  });

  it('no deja que un nombre salga de la carpeta al descomprimir', () => {
    expect(safeZipPath('../../etc/passwd')).toBe('etc/passwd');
    expect(safeZipPath('\\a\\..\\b.txt')).toBe('a/b.txt');
    const files = readZip(buildZip([{ name: '../x.txt', data: Buffer.from('x') }]));
    expect(Object.keys(files)).toEqual(['x.txt']);
  });

  it('dos archivos con el mismo nombre no se pisan', () => {
    const files = readZip(
      buildZip([
        { name: 'a/doc.pdf', data: Buffer.from('1') },
        { name: 'a/doc.pdf', data: Buffer.from('2') },
      ]),
    );
    expect(Object.keys(files)).toEqual(['a/doc.pdf', 'a/doc (2).pdf']);
  });

  it('un .zip vacío sigue siendo válido', () => {
    expect(readZip(buildZip([]))).toEqual({});
  });
});
