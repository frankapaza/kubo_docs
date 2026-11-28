import { PdfRendererService, signatureStatusLine } from './pdf-renderer.service';

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const acta = { id: 3, version: 1, status: 'IN_REVIEW', contentMarkdown: '# Acta\n\nTexto.' } as any;
const sig = (o: any) => ({ id: 1, signerName: 'Ana Pérez', signerDocument: '45678912', signerRole: 'Área usuaria', signatureHash: 'a'.repeat(64), signedAt: new Date('2026-11-28T16:00:00Z'), ...o });

describe('PDF del acta: firmas con trazo y anexos', () => {
  const pdf = new PdfRendererService();

  it('dibuja el acta con firmas con trazo y anexos (foto y texto) sin fallar', async () => {
    const base = await pdf.renderWith({ acta, signatures: [sig({ method: 'USER' })] });
    const full = await pdf.renderWith({
      acta,
      signatures: [sig({ method: 'IN_PERSON', signaturePng: PNG_1X1 })],
      annexes: [
        { id: 1, position: 1, place: 'ANEXO', section: null, caption: 'Pizarra con acuerdos', image: PNG_1X1, imageMime: 'image/png' },
        { id: 2, position: 2, place: 'ANEXO', section: null, caption: 'Solo texto', image: null, imageMime: null },
      ] as any,
    });
    expect(full.subarray(0, 4).toString()).toBe('%PDF');
    expect(full.length).toBeGreaterThan(base.length);
  });

  it('sin anexos no agrega páginas', async () => {
    const a = await pdf.renderWith({ acta, signatures: [sig({ method: 'USER' })] });
    const b = await pdf.renderWith({ acta, signatures: [sig({ method: 'USER' })], annexes: [] });
    const pages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages(b)).toBe(pages(a));
  });

  it('la línea de estado dice cómo firmó y si falta la confirmación', () => {
    expect(signatureStatusLine(sig({ method: 'IN_PERSON' }))).toMatch(/^Firmado en pantalla/);
    expect(signatureStatusLine(sig({ method: 'EMAIL', confirmEmail: 'ana@cliente.pe', emailConfirmedAt: null }))).toBe('Pendiente: confirmar por correo (ana@cliente.pe)');
    expect(signatureStatusLine(sig({ method: 'EMAIL', confirmEmail: 'ana@cliente.pe', emailConfirmedAt: new Date('2026-11-28T17:00:00Z') }))).toMatch(/^Confirmado por correo \(ana@cliente\.pe\)/);
    expect(signatureStatusLine(sig({ method: 'BOTH', confirmEmail: 'ana@cliente.pe', emailConfirmedAt: null }))).toBe('Firmado en pantalla · pendiente: confirmar por correo (ana@cliente.pe)');
  });
});
