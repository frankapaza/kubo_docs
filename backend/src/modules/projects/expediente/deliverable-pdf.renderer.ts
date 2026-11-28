import PDFDocument from 'pdfkit';

import { MarkdownPdf } from '../../../common/pdf/markdown-pdf.helper';
import { KUBO_LOGO_PNG_BASE64 } from '../../email/kubo-logo';
import type { DocSection } from './deliverable-document';

export interface PdfHistoryRow {
  version: string | null;
  actionLabel: string;
  actorName: string | null;
  createdAt: string;
  note: string | null;
}

export interface PdfAttachment {
  sectionKey: string;
  place: 'INLINE' | 'ANEXO';
  caption: string | null;
  image: Buffer;
}

export interface DeliverablePdfInput {
  title: string;
  nomenclature: string;
  version: string | null;
  statusLabel: string;
  projectName: string;
  projectCode: string;
  clientName: string | null;
  sections: DocSection[];
  history: PdfHistoryRow[];
  attachments: PdfAttachment[];
}

const BLUE = '#053777';
const INK = '#0F172A';
const MUTED = '#475569';
const BORDER = '#E2E8F0';

/** Numeración de figuras y anexos en el orden del documento (sección, luego posición). */
export function numberAttachments(sections: DocSection[], attachments: PdfAttachment[]) {
  const order = new Map(sections.map((s, i) => [s.key, i]));
  const known = attachments.filter((a) => order.has(a.sectionKey));
  const sorted = known
    .map((a, i) => ({ a, i }))
    .sort((x, y) => order.get(x.a.sectionKey)! - order.get(y.a.sectionKey)! || x.i - y.i)
    .map((x) => x.a);
  let fig = 0;
  let anx = 0;
  return sorted.map((a) => ({
    ...a,
    figure: a.place === 'INLINE' ? ++fig : null,
    annex: a.place === 'ANEXO' ? ++anx : null,
    from: sections[order.get(a.sectionKey)!],
  }));
}

/**
 * El PDF del documento en línea de un entregable: carátula con logo, historial
 * de revisiones, índice, secciones con sus figuras y, solo si hay, anexos.
 */
export class DeliverablePdfRenderer {
  private readonly md = new MarkdownPdf();

  render(input: DeliverablePdfInput): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 64, bottom: 64, left: 56, right: 56 },
        bufferPages: true,
        info: { Title: `${input.nomenclature} — ${input.title}`, Author: 'Kubo Platform', Subject: input.title },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const numbered = numberAttachments(input.sections, input.attachments);
      this.cover(doc, input);
      this.index(doc, input, numbered.some((a) => a.annex != null));
      for (const s of input.sections) {
        this.section(doc, s, numbered.filter((a) => a.sectionKey === s.key && a.figure != null));
      }
      const annexes = numbered.filter((a) => a.annex != null);
      if (annexes.length) this.annexes(doc, annexes);
      this.footer(doc, input);
      doc.end();
    });
  }

  private cw(doc: PDFKit.PDFDocument) {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
  }

  private cover(doc: PDFKit.PDFDocument, input: DeliverablePdfInput) {
    const left = doc.page.margins.left;
    const cw = this.cw(doc);
    try {
      doc.image(Buffer.from(KUBO_LOGO_PNG_BASE64, 'base64'), left, 56, { fit: [140, 44] });
    } catch {
      /* sin logo, el texto basta */
    }
    doc.moveTo(left, 120).lineTo(left + cw, 120).lineWidth(2).strokeColor(BLUE).stroke();
    doc.y = 170;
    doc.font('Helvetica-Bold').fontSize(24).fillColor(BLUE).text(input.title, left, doc.y, { width: cw });
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(13).fillColor(INK).text(`${input.projectName} (${input.projectCode})`, { width: cw });
    if (input.clientName) doc.fontSize(11).fillColor(MUTED).text(`Cliente: ${input.clientName}`, { width: cw });
    doc.moveDown(1.2);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(input.nomenclature, { width: cw });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(MUTED)
      .text(`Versión ${input.version ?? '—'} · ${input.statusLabel} · ${new Date().toLocaleDateString('es-PE')}`, { width: cw });

    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BLUE).text('HISTORIAL DE REVISIONES', { width: cw });
    doc.moveDown(0.4);
    const cols = [52, 80, 130, 90, cw - 52 - 80 - 130 - 90];
    const heads = ['Versión', 'Acción', 'Responsable', 'Fecha', 'Nota'];
    const row = (cells: string[], bold = false) => {
      const h = Math.max(
        18,
        ...cells.map((c, i) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).heightOfString(c, { width: cols[i] - 8 }) + 8),
      );
      if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
      const y = doc.y;
      let x = left;
      cells.forEach((c, i) => {
        doc.rect(x, y, cols[i], h).lineWidth(0.5).strokeColor(BORDER).stroke();
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(INK).text(c, x + 4, y + 4, { width: cols[i] - 8 });
        x += cols[i];
      });
      doc.y = y + h;
      doc.x = left;
    };
    row(heads, true);
    const hist = input.history.length ? input.history : [];
    for (const h of hist) {
      row([
        h.version ? `V${h.version}` : '',
        h.actionLabel,
        h.actorName ?? '—',
        new Date(h.createdAt).toLocaleDateString('es-PE'),
        (h.note ?? '').slice(0, 300),
      ]);
    }
    if (!hist.length) row(['', 'Borrador', '—', new Date().toLocaleDateString('es-PE'), 'Sin versiones registradas']);
  }

  private index(doc: PDFKit.PDFDocument, input: DeliverablePdfInput, hasAnnexes: boolean) {
    doc.addPage();
    const cw = this.cw(doc);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(BLUE).text('Índice', { width: cw });
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(10.5).fillColor(INK);
    for (const s of input.sections) doc.text(`${s.num ? s.num + '  ' : ''}${s.title}`, { width: cw });
    if (hasAnnexes) doc.text('Anexos', { width: cw });
    doc.addPage();
  }

  private section(doc: PDFKit.PDFDocument, s: DocSection, figures: ReturnType<typeof numberAttachments>) {
    const cw = this.cw(doc);
    this.md.ensureSpace(doc, 60);
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(BLUE).text(`${s.num ? s.num + ' ' : ''}${s.title}`, doc.page.margins.left, doc.y, { width: cw });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10.5).fillColor(INK);
    if (s.body.trim()) this.md.drawBody(doc, s.body);
    for (const f of figures) this.image(doc, f.image, `Figura ${f.figure}. ${f.caption ?? ''}`.trim());
  }

  private image(doc: PDFKit.PDFDocument, image: Buffer, caption: string) {
    const cw = this.cw(doc);
    const maxH = 300;
    this.md.ensureSpace(doc, maxH + 30);
    const top = doc.y + 6;
    try {
      doc.image(image, doc.page.margins.left, top, { fit: [cw, maxH], align: 'center' });
      doc.y = top + maxH + 4;
    } catch {
      doc.y = top;
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('[imagen no disponible]', { width: cw, align: 'center' });
    }
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(caption, doc.page.margins.left, doc.y, { width: cw, align: 'center' });
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(10.5).fillColor(INK);
  }

  private annexes(doc: PDFKit.PDFDocument, annexes: ReturnType<typeof numberAttachments>) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(14).fillColor(BLUE).text('Anexos', { width: this.cw(doc) });
    doc.moveDown(0.4);
    for (const a of annexes) {
      const from = a.from.num || a.from.title;
      this.image(doc, a.image, `Anexo ${a.annex} (de ${from}). ${a.caption ?? ''}`.trim());
    }
  }

  private footer(doc: PDFKit.PDFDocument, input: DeliverablePdfInput) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(MUTED)
        .text(`${input.nomenclature} · Página ${i + 1} de ${range.count}`, doc.page.margins.left, doc.page.height - 40, {
          width: this.cw(doc),
          align: 'right',
          lineBreak: false,
        });
      doc.page.margins.bottom = bottom;
    }
  }
}
