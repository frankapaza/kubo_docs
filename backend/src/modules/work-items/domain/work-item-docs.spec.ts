import { deflateRawSync } from 'zlib';

import { DOCX_MIME, MAX_DOC_BYTES, assertDocAcceptable, detectDocMime, docxText } from './work-item-docs';

/** Un ZIP mínimo (sin CRC: el lector no lo comprueba) con las entradas dadas, comprimidas con deflate. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const DOCUMENT_XML =
  '<?xml version="1.0"?><w:document><w:body>' +
  '<w:p><w:r><w:t>Objetivo</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Exportar &amp; filtrar </w:t></w:r><w:r><w:t>pagos</w:t></w:r></w:p>' +
  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Campo</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Tipo</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  '</w:body></w:document>';

const DOCX = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': DOCUMENT_XML });

describe('detectDocMime', () => {
  it('reconoce un PDF por su firma', () => {
    expect(detectDocMime(Buffer.from('%PDF-1.7\n...'))).toBe('application/pdf');
  });

  it('reconoce un Word (.docx) por su contenido, no por la extensión', () => {
    expect(detectDocMime(DOCX)).toBe(DOCX_MIME);
  });

  it('un ZIP cualquiera no es un Word', () => {
    expect(detectDocMime(zip({ 'leeme.txt': 'hola' }))).toBeNull();
  });

  it('un Excel (.xlsx) no es un Word', () => {
    expect(detectDocMime(zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<w/>' }))).toBeNull();
  });

  it('rechaza texto plano y el .doc antiguo', () => {
    expect(detectDocMime(Buffer.from('hola'))).toBeNull();
    expect(detectDocMime(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBeNull();
  });

  it('acepta imágenes (capturas para el manual)', () => {
    expect(detectDocMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
  });
});

describe('assertDocAcceptable', () => {
  it('pasa de los 15 MB: 413', () => {
    const big = Buffer.alloc(MAX_DOC_BYTES + 1);
    big.write('%PDF-');
    expect(() => assertDocAcceptable(big)).toThrow(/15 MB/);
  });

  it('un tipo no admitido explica cuáles sí', () => {
    expect(() => assertDocAcceptable(Buffer.from('hola'))).toThrow(/PDF o Word/);
  });

  it('un archivo vacío se rechaza', () => {
    expect(() => assertDocAcceptable(Buffer.alloc(0))).toThrow();
  });
});

describe('docxText', () => {
  it('saca el texto con un párrafo por línea y las celdas separadas', () => {
    const text = docxText(DOCX);
    expect(text).toContain('Objetivo\nExportar & filtrar pagos');
    expect(text).toContain('Campo | Tipo');
  });

  it('un archivo que no es Word devuelve null', () => {
    expect(docxText(Buffer.from('%PDF-1.7'))).toBeNull();
  });
});
