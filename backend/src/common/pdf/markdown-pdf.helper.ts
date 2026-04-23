/**
 * Helper compartido para renderizar markdown a PDF con PDFKit.
 * Usado por actas y documentos comerciales para no duplicar la lógica.
 */

export const PDF_COLORS = {
  primary: '#4F46E5',
  ink: '#0F172A',
  muted: '#475569',
  border: '#E2E8F0',
  headerBg: '#F1F5F9',
  zebra: '#F8FAFC',
};

export class MarkdownPdf {
  contentWidth(doc: PDFKit.PDFDocument): number {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
  }

  /** Quita bold/italic/code inline markers (el PDF no interpreta markdown inline). */
  strip(s: string): string {
    return s
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1');
  }

  ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
  }

  drawBody(doc: PDFKit.PDFDocument, markdown: string): void {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const cw = this.contentWidth(doc);

    const isBlock = (t: string) =>
      t.startsWith('#') ||
      t.startsWith('|') ||
      /^(-|\*|\+)\s+/.test(t) ||
      /^\d+\.\s+/.test(t) ||
      /^(-{3,}|_{3,}|\*{3,})$/.test(t);

    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      const t = l.trim();

      if (!t) {
        doc.moveDown(0.35);
        i++;
        continue;
      }

      if (t.startsWith('# ')) {
        this.ensureSpace(doc, 28);
        doc
          .fillColor(PDF_COLORS.ink)
          .font('Helvetica-Bold')
          .fontSize(15)
          .text(this.strip(t.slice(2)), { width: cw });
        doc.moveDown(0.25);
        i++;
        continue;
      }
      if (t.startsWith('## ')) {
        this.ensureSpace(doc, 22);
        doc.moveDown(0.15);
        doc
          .fillColor(PDF_COLORS.ink)
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(this.strip(t.slice(3)), { width: cw });
        doc.moveDown(0.15);
        i++;
        continue;
      }
      if (t.startsWith('### ')) {
        this.ensureSpace(doc, 18);
        doc
          .fillColor(PDF_COLORS.ink)
          .font('Helvetica-Bold')
          .fontSize(10.5)
          .text(this.strip(t.slice(4)), { width: cw });
        doc.moveDown(0.1);
        i++;
        continue;
      }
      if (/^(-{3,}|_{3,}|\*{3,})$/.test(t)) {
        this.ensureSpace(doc, 10);
        const y = doc.y + 3;
        doc
          .strokeColor(PDF_COLORS.border)
          .lineWidth(0.5)
          .moveTo(doc.page.margins.left, y)
          .lineTo(doc.page.width - doc.page.margins.right, y)
          .stroke();
        doc.y = y + 8;
        i++;
        continue;
      }
      if (t.startsWith('|')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        this.drawTable(doc, tableLines);
        doc.moveDown(0.3);
        continue;
      }
      if (/^(-|\*|\+)\s+/.test(t)) {
        doc.fillColor(PDF_COLORS.ink).font('Helvetica').fontSize(10);
        while (i < lines.length && /^(-|\*|\+)\s+/.test(lines[i].trim())) {
          const item = lines[i].trim().replace(/^(-|\*|\+)\s+/, '');
          const text = this.strip(item);
          const x = doc.page.margins.left + 6;
          const h = doc.heightOfString(text, { width: cw - 18 }) + 2;
          this.ensureSpace(doc, h);
          const y = doc.y;
          doc.text('•', x, y, { lineBreak: false });
          doc.text(text, x + 12, y, { width: cw - 18, align: 'left' });
          i++;
        }
        doc.moveDown(0.2);
        continue;
      }
      if (/^\d+\.\s+/.test(t)) {
        doc.fillColor(PDF_COLORS.ink).font('Helvetica').fontSize(10);
        let n = 1;
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          const item = lines[i].trim().replace(/^\d+\.\s+/, '');
          const text = this.strip(item);
          const x = doc.page.margins.left + 6;
          const h = doc.heightOfString(text, { width: cw - 22 }) + 2;
          this.ensureSpace(doc, h);
          const y = doc.y;
          doc.text(`${n}.`, x, y, { lineBreak: false });
          doc.text(text, x + 16, y, { width: cw - 22, align: 'left' });
          n++;
          i++;
        }
        doc.moveDown(0.2);
        continue;
      }

      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !isBlock(lines[i].trim())) {
        para.push(lines[i].trim());
        i++;
      }
      const text = this.strip(para.join(' '));
      const h = doc.heightOfString(text, { width: cw }) + 2;
      this.ensureSpace(doc, h);
      doc
        .fillColor(PDF_COLORS.ink)
        .font('Helvetica')
        .fontSize(10)
        .text(text, doc.page.margins.left, doc.y, { width: cw, align: 'justify' });
      doc.moveDown(0.3);
    }
  }

  drawTable(doc: PDFKit.PDFDocument, lines: string[]): void {
    const rows = lines
      .map((l) => l.trim())
      .filter((l) => l.startsWith('|'))
      .map((l) =>
        l
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim()),
      );
    if (rows.length === 0) return;
    const isSep = (r: string[]) => r.every((c) => /^:?-+:?$/.test(c));
    const header = rows[0];
    const body = rows.length > 1 && isSep(rows[1]) ? rows.slice(2) : rows.slice(1);
    const ncols = header.length;
    if (ncols === 0) return;
    const startX = doc.page.margins.left;
    const tableWidth = this.contentWidth(doc);
    const colW = tableWidth / ncols;
    const pad = 6;

    const headerHeight = 22;
    this.ensureSpace(doc, headerHeight + 24);
    let y = doc.y;

    doc.save().rect(startX, y, tableWidth, headerHeight).fill(PDF_COLORS.headerBg).restore();
    doc.fillColor(PDF_COLORS.ink).font('Helvetica-Bold').fontSize(9);
    header.forEach((h, c) => {
      doc.text(this.strip(h), startX + c * colW + pad, y + 7, {
        width: colW - pad * 2,
        ellipsis: true,
        lineBreak: false,
      });
    });
    doc
      .strokeColor(PDF_COLORS.border)
      .lineWidth(0.5)
      .moveTo(startX, y + headerHeight)
      .lineTo(startX + tableWidth, y + headerHeight)
      .stroke();
    y += headerHeight;

    doc.font('Helvetica').fontSize(9);
    body.forEach((r, ri) => {
      let maxH = 16;
      r.forEach((c) => {
        const h = doc.heightOfString(this.strip(c), { width: colW - pad * 2 }) + 10;
        if (h > maxH) maxH = h;
      });
      if (y + maxH > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      if (ri % 2 === 1) {
        doc.save().rect(startX, y, tableWidth, maxH).fill(PDF_COLORS.zebra).restore();
      }
      doc.fillColor(PDF_COLORS.ink);
      r.forEach((c, ci) => {
        doc.text(this.strip(c), startX + ci * colW + pad, y + 5, {
          width: colW - pad * 2,
        });
      });
      doc
        .strokeColor(PDF_COLORS.border)
        .lineWidth(0.4)
        .moveTo(startX, y + maxH)
        .lineTo(startX + tableWidth, y + maxH)
        .stroke();
      y += maxH;
    });
    doc.y = y + 4;
    doc.x = doc.page.margins.left;
  }
}
