import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Acta } from '../entities/acta.entity';
import { ActaSignature } from '../entities/acta-signature.entity';
import { WorkspaceSetting } from '../../workspace/entities/workspace-setting.entity';

export interface PdfRenderContext {
  acta: Acta;
  meetingTitle?: string | null;
  projectName?: string | null;
  signatures?: ActaSignature[];
  emisor?: WorkspaceSetting | null;
  emisorLogoBuffer?: Buffer | null;
}

const COLORS = {
  primary: '#4F46E5',
  ink: '#0F172A',
  muted: '#475569',
  border: '#E2E8F0',
  headerBg: '#F1F5F9',
  zebra: '#F8FAFC',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  APPROVED: 'Aprobada',
  EXPORTED: 'Exportada',
};

@Injectable()
export class PdfRendererService {
  render(acta: Acta): Promise<Buffer> {
    return this.renderWith({ acta });
  }

  renderWith(ctx: PdfRenderContext): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        // bottom ampliado a 90 para dar espacio al footer de 3 líneas
        margins: { top: 60, bottom: 90, left: 56, right: 56 },
        bufferPages: true,
        info: {
          Title: `Acta #${ctx.acta.id}`,
          Author: ctx.emisor?.razonSocial ?? 'Kubo DevDocs',
          Subject: ctx.meetingTitle ?? 'Acta de reunión',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.drawHeader(doc, ctx);
      this.drawBody(doc, ctx.acta.contentMarkdown ?? '');
      if (ctx.signatures && ctx.signatures.length > 0) {
        this.drawSignatures(doc, ctx.signatures);
      }
      this.drawFooters(doc, ctx);

      doc.end();
    });
  }

  private contentWidth(doc: PDFKit.PDFDocument): number {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
  }

  private strip(s: string): string {
    return s
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1');
  }

  private ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
  }

  private drawHeader(doc: PDFKit.PDFDocument, ctx: PdfRenderContext) {
    const w = doc.page.width;
    const emisor = ctx.emisor;
    const brandName = emisor?.razonSocial ?? 'KUBO DEVDOCS';
    const BAND_HEIGHT = 60;

    // Banda de marca superior
    doc.save();
    doc.rect(0, 0, w, BAND_HEIGHT).fill(COLORS.primary);
    doc.restore();

    // Logo a la izquierda (si hay imagen); si no, razón social con ellipsis
    const logoBuffer = ctx.emisorLogoBuffer;
    let titleX = 56;
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 56, 12, { fit: [120, 36] });
        titleX = 56 + 120 + 16;
      } catch {
        // Si el buffer no es una imagen válida, caemos al texto
      }
    }
    const titleText = logoBuffer
      ? 'ACTA DE REUNIÓN'
      : `${brandName.toUpperCase()}  ·  ACTA DE REUNIÓN`;
    doc
      .fillColor('white')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(titleText, titleX, 18, {
        width: w - titleX - 56,
        align: 'left',
        lineBreak: false,
        ellipsis: true,
      });
    doc
      .fillColor('white')
      .font('Helvetica')
      .fontSize(9)
      .text(
        `Acta #${ctx.acta.id}  ·  Versión ${ctx.acta.version}  ·  Estado: ${
          STATUS_LABEL[ctx.acta.status] ?? ctx.acta.status
        }`,
        titleX,
        38,
        { width: w - titleX - 56, lineBreak: false },
      );

    // Metadata del acta (título + proyecto + aprobación)
    doc.y = BAND_HEIGHT + 16;
    doc.x = 56;
    doc.fillColor(COLORS.ink);
    if (ctx.meetingTitle) {
      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(ctx.meetingTitle, 56, doc.y, { width: w - 112 });
      doc.moveDown(0.2);
    }
    const meta: string[] = [];
    if (ctx.projectName) meta.push(`Proyecto: ${ctx.projectName}`);
    if (ctx.acta.approvedAt) {
      meta.push(`Aprobada: ${new Date(ctx.acta.approvedAt).toLocaleString('es-PE')}`);
    }
    if (meta.length > 0) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(COLORS.muted)
        .text(meta.join('   ·   '), 56, doc.y, { width: w - 112 });
      doc.fillColor(COLORS.ink);
    }
    doc.moveDown(0.5);
    const y = doc.y;
    doc
      .strokeColor(COLORS.border)
      .lineWidth(0.5)
      .moveTo(56, y)
      .lineTo(w - 56, y)
      .stroke();
    doc.y = y + 10;
    doc.x = doc.page.margins.left;
  }

  private drawBody(doc: PDFKit.PDFDocument, markdown: string) {
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
          .fillColor(COLORS.ink)
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
          .fillColor(COLORS.ink)
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
          .fillColor(COLORS.ink)
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
          .strokeColor(COLORS.border)
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
        doc.fillColor(COLORS.ink).font('Helvetica').fontSize(10);
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
        doc.fillColor(COLORS.ink).font('Helvetica').fontSize(10);
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
        .fillColor(COLORS.ink)
        .font('Helvetica')
        .fontSize(10)
        .text(text, doc.page.margins.left, doc.y, { width: cw, align: 'justify' });
      doc.moveDown(0.3);
    }
  }

  private drawTable(doc: PDFKit.PDFDocument, lines: string[]) {
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

    doc.save().rect(startX, y, tableWidth, headerHeight).fill(COLORS.headerBg).restore();
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9);
    header.forEach((h, c) => {
      doc.text(this.strip(h), startX + c * colW + pad, y + 7, {
        width: colW - pad * 2,
        ellipsis: true,
        lineBreak: false,
      });
    });
    doc
      .strokeColor(COLORS.border)
      .lineWidth(0.5)
      .moveTo(startX, y + headerHeight)
      .lineTo(startX + tableWidth, y + headerHeight)
      .stroke();
    y += headerHeight;

    doc.font('Helvetica').fontSize(9);
    body.forEach((r, ri) => {
      let maxH = 16;
      r.forEach((c, _ci) => {
        const h = doc.heightOfString(this.strip(c), { width: colW - pad * 2 }) + 10;
        if (h > maxH) maxH = h;
      });
      if (y + maxH > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      if (ri % 2 === 1) {
        doc.save().rect(startX, y, tableWidth, maxH).fill(COLORS.zebra).restore();
      }
      doc.fillColor(COLORS.ink);
      r.forEach((c, ci) => {
        doc.text(this.strip(c), startX + ci * colW + pad, y + 5, {
          width: colW - pad * 2,
        });
      });
      doc
        .strokeColor(COLORS.border)
        .lineWidth(0.4)
        .moveTo(startX, y + maxH)
        .lineTo(startX + tableWidth, y + maxH)
        .stroke();
      y += maxH;
    });
    doc.y = y + 4;
    doc.x = doc.page.margins.left;
  }

  private drawSignatures(doc: PDFKit.PDFDocument, sigs: ActaSignature[]) {
    const cw = this.contentWidth(doc);
    this.ensureSpace(doc, 140);
    doc.moveDown(0.6);
    doc
      .fillColor(COLORS.ink)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('Firmas', doc.page.margins.left, doc.y, { width: cw });
    doc.moveDown(0.4);

    const cellW = (cw - 16) / 2;
    const cellH = 96;
    let x = doc.page.margins.left;
    let y = doc.y;

    sigs.forEach((s, idx) => {
      if (y + cellH > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        x = doc.page.margins.left;
      }
      doc
        .strokeColor(COLORS.border)
        .lineWidth(0.6)
        .rect(x, y, cellW, cellH)
        .stroke();
      doc
        .fillColor(COLORS.muted)
        .font('Helvetica')
        .fontSize(8)
        .text(s.signerRole ?? 'Participante', x + 10, y + 8, {
          width: cellW - 20,
          lineBreak: false,
        });

      const sigLineY = y + cellH - 38;
      doc
        .strokeColor(COLORS.ink)
        .lineWidth(0.6)
        .moveTo(x + 14, sigLineY)
        .lineTo(x + cellW - 14, sigLineY)
        .stroke();
      doc
        .fillColor(COLORS.ink)
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text(s.signerName, x + 10, sigLineY + 4, { width: cellW - 20, lineBreak: false });

      const meta = [
        s.signerDocument ? `DNI: ${s.signerDocument}` : null,
        `Firmado: ${new Date(s.signedAt).toLocaleString('es-PE')}`,
      ]
        .filter(Boolean)
        .join('  ·  ');
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLORS.muted)
        .text(meta, x + 10, sigLineY + 18, { width: cellW - 20, lineBreak: false });
      doc
        .font('Courier')
        .fontSize(6.5)
        .fillColor(COLORS.muted)
        .text(
          `hash ${s.signatureHash.slice(0, 16)}…${s.signatureHash.slice(-8)}`,
          x + 10,
          sigLineY + 28,
          { width: cellW - 20, lineBreak: false },
        );

      if (idx % 2 === 0) {
        x += cellW + 16;
      } else {
        x = doc.page.margins.left;
        y += cellH + 14;
      }
    });

    if (sigs.length % 2 === 1) {
      doc.y = y + cellH + 8;
    } else {
      doc.y = y + 8;
    }
    doc.x = doc.page.margins.left;
  }

  private drawFooters(doc: PDFKit.PDFDocument, ctx: PdfRenderContext) {
    const range = doc.bufferedPageRange();
    const e = ctx.emisor;
    const brand = e?.razonSocial ?? 'Kubo DevDocs';

    // Construir 2 líneas de membrete
    const line1Parts: string[] = [];
    if (e?.ruc) line1Parts.push(`RUC ${e.ruc}`);
    if (e?.address) line1Parts.push(e.address);
    const line2Parts: string[] = [];
    if (e?.phone) line2Parts.push(e.phone);
    if (e?.email) line2Parts.push(e.email);
    if (e?.website) line2Parts.push(e.website);

    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const w = doc.page.width;
      const h = doc.page.height;

      // Neutralizamos el margen inferior de ESTA página mientras dibujamos
      // el footer. Sin esto PDFKit auto-inserta una nueva página después
      // de cada `doc.text()` porque cree que estamos pasando el área útil.
      const origBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;

      try {
        // Línea divisoria sutil encima del footer
        doc
          .strokeColor(COLORS.border)
          .lineWidth(0.5)
          .moveTo(56, h - 70)
          .lineTo(w - 56, h - 70)
          .stroke();

        // Membrete del emisor (2 líneas)
        doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted);
        if (line1Parts.length > 0) {
          doc.text(line1Parts.join('  ·  '), 56, h - 62, {
            width: w - 112,
            align: 'center',
            lineBreak: false,
            ellipsis: true,
          });
        }
        if (line2Parts.length > 0) {
          doc.text(line2Parts.join('  ·  '), 56, h - 51, {
            width: w - 112,
            align: 'center',
            lineBreak: false,
            ellipsis: true,
          });
        }

        // Marca + paginación
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.muted);
        doc.text(
          `${brand}  ·  Página ${i + 1} de ${range.count}`,
          56,
          h - 36,
          { width: w - 112, align: 'center', lineBreak: false },
        );
      } finally {
        doc.page.margins.bottom = origBottomMargin;
      }
    }
  }
}
