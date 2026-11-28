import { buildZip } from '../../../common/zip/zip-writer';
import { assertDeliverableFile, detectDeliverableMime, MAX_DELIVERABLE_BYTES } from './deliverable-files';

const ooxml = (...names: string[]) =>
  buildZip(['[Content_Types].xml', ...names].map((name) => ({ name, data: Buffer.from('<x/>') })));
const OLE = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(600)]);

describe('archivos de un entregable', () => {
  it('reconoce PDF, Word, Excel y PowerPoint por su contenido', () => {
    expect(detectDeliverableMime(Buffer.from('%PDF-1.7 ...'), 'a.pdf')).toBe('application/pdf');
    expect(detectDeliverableMime(ooxml('word/document.xml'), 'a.docx')).toMatch(/wordprocessingml/);
    expect(assertDeliverableFile(ooxml('xl/workbook.xml'), 'cronograma.xlsx').ext).toBe('xlsx');
    expect(assertDeliverableFile(ooxml('ppt/presentation.xml'), 'capacitación.pptx').ext).toBe('pptx');
  });

  it('acepta un .mpp (OLE) solo si se llama .mpp; un .doc antiguo no', () => {
    expect(assertDeliverableFile(OLE, 'Cronograma.MPP')).toEqual({ mimeType: 'application/vnd.ms-project', ext: 'mpp' });
    expect(() => assertDeliverableFile(OLE, 'acta.doc')).toThrow(/Se admiten PDF/);
  });

  it('rechaza un ZIP cualquiera, un vacío y uno demasiado grande', () => {
    expect(() => assertDeliverableFile(buildZip([{ name: 'a.txt', data: Buffer.from('a') }]), 'a.xlsx')).toThrow(/Se admiten/);
    expect(() => assertDeliverableFile(Buffer.alloc(0), 'a.pdf')).toThrow(/vacío/);
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(MAX_DELIVERABLE_BYTES)]);
    expect(() => assertDeliverableFile(big, 'a.pdf')).toThrow(/20 MB/);
  });
});
