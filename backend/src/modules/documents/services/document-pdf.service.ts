import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { CommercialDocument } from '../entities/commercial-document.entity';
import { WorkspaceSetting } from '../../workspace/entities/workspace-setting.entity';
import { MarkdownPdf, PDF_COLORS } from '../../../common/pdf/markdown-pdf.helper';
import { DocumentSignatory } from '../../document-signatories/entities/document-signatory.entity';

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  CONTRACT: 'Contrato',
  QUOTE: 'Cotización',
  NDA: 'Acuerdo de Confidencialidad',
  SOW: 'Statement of Work',
  TDR: 'Términos de Referencia',
  ADDENDUM: 'Addendum',
  OTHER: 'Documento',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviado',
  SIGNED: 'Firmado',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
};

export interface DocumentPdfContext {
  doc: CommercialDocument;
  emisor?: WorkspaceSetting | null;
  emisorLogoBuffer?: Buffer | null;
  signatories?: DocumentSignatory[];
}

@Injectable()
export class DocumentPdfService {
  private readonly md = new MarkdownPdf();

  render(ctx: DocumentPdfContext): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 90, left: 56, right: 56 },
        bufferPages: true,
        info: {
          Title: ctx.doc.title,
          Author: ctx.emisor?.razonSocial ?? 'Kubo DevDocs',
          Subject: DOCUMENT_TYPE_LABEL[ctx.doc.type] ?? 'Documento',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.drawHeader(doc, ctx);
      this.md.drawBody(doc, ctx.doc.contentMarkdown ?? '');
      if (ctx.signatories && ctx.signatories.length > 0) {
        this.drawSignatories(doc, ctx.signatories);
      }
      this.drawFooters(doc, ctx);

      doc.end();
    });
  }

  private drawHeader(doc: PDFKit.PDFDocument, ctx: DocumentPdfContext) {
    const w = doc.page.width;
    const emisor = ctx.emisor;
    const BAND_HEIGHT = 56;

    // Banda superior con logo o razón social
    doc.save();
    doc.rect(0, 0, w, BAND_HEIGHT).fill(PDF_COLORS.primary);
    doc.restore();

    let titleX = 56;
    if (ctx.emisorLogoBuffer) {
      try {
        doc.image(ctx.emisorLogoBuffer, 56, 12, { fit: [110, 32] });
        titleX = 56 + 110 + 14;
      } catch {
        // buffer inválido — caemos al texto
      }
    }

    const brandName = emisor?.razonSocial ?? 'KUBO DEVDOCS';
    const typeLabel =
      DOCUMENT_TYPE_LABEL[ctx.doc.type]?.toUpperCase() ?? 'DOCUMENTO';
    const mainText = ctx.emisorLogoBuffer ? typeLabel : `${brandName.toUpperCase()}  ·  ${typeLabel}`;

    doc
      .fillColor('white')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(mainText, titleX, 18, {
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
        `#${ctx.doc.id}  ·  Versión ${ctx.doc.version}  ·  ${STATUS_LABEL[ctx.doc.status] ?? ctx.doc.status}`,
        titleX,
        36,
        { width: w - titleX - 56, lineBreak: false },
      );

    // Posicionamos el cursor debajo de la banda para que el body empiece ahí.
    doc.y = BAND_HEIGHT + 16;
    doc.x = doc.page.margins.left;
    doc.fillColor(PDF_COLORS.ink);
  }

  private drawSignatories(doc: PDFKit.PDFDocument, sigs: DocumentSignatory[]) {
    const STATUS_LABEL: Record<string, string> = {
      PENDING: 'Pendiente',
      SIGNED: 'Firmó ✓',
      REFUSED: 'No quiso firmar',
      ABSENT_EARLY: 'Asistió y se ausentó',
      ABSENT: 'No asistió',
    };
    const STATUS_COLOR: Record<string, string> = {
      PENDING: PDF_COLORS.muted,
      SIGNED: '#16a34a',
      REFUSED: '#dc2626',
      ABSENT_EARLY: '#d97706',
      ABSENT: PDF_COLORS.muted,
    };

    const pageW = doc.page.width;
    const left = doc.page.margins.left;
    const usable = pageW - left - doc.page.margins.right;

    // Separador + título
    doc.moveDown(1.5);
    doc
      .strokeColor(PDF_COLORS.border)
      .lineWidth(0.5)
      .moveTo(left, doc.y)
      .lineTo(pageW - doc.page.margins.right, doc.y)
      .stroke();
    doc.moveDown(0.6);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(PDF_COLORS.ink)
      .text('FIRMANTES Y CONFORMIDAD', left, doc.y);
    doc.moveDown(0.5);

    // Cabecera de tabla
    const colW = [usable * 0.28, usable * 0.14, usable * 0.18, usable * 0.14, usable * 0.26];
    const headers = ['Nombre', 'Tipo', 'Cargo', 'N° Doc', 'Conformidad'];
    const ROW_H = 18;
    const headerY = doc.y;

    doc.rect(left, headerY, usable, ROW_H).fill('#F1F5F9');
    doc.fillColor(PDF_COLORS.muted).font('Helvetica-Bold').fontSize(7.5);
    let cx = left + 4;
    headers.forEach((h, i) => {
      doc.text(h, cx, headerY + 5, { width: colW[i] - 4, lineBreak: false });
      cx += colW[i];
    });

    // Filas
    doc.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.ink);
    sigs.forEach((s, idx) => {
      const rowY = headerY + ROW_H + idx * ROW_H;

      // Fondo alternado
      if (idx % 2 === 1) {
        doc.rect(left, rowY, usable, ROW_H).fill('#F8FAFC');
      }

      const cells = [
        s.fullName,
        s.kind === 'INTERNAL' ? 'Interno' : 'Externo',
        s.role ?? '—',
        s.documentNumber ?? '—',
        STATUS_LABEL[s.conformityStatus] ?? s.conformityStatus,
      ];

      let cellX = left + 4;
      cells.forEach((val, i) => {
        const color =
          i === 4 ? (STATUS_COLOR[s.conformityStatus] ?? PDF_COLORS.ink) : PDF_COLORS.ink;
        const bold = i === 4 && s.conformityStatus !== 'PENDING';
        doc
          .font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fillColor(color)
          .text(val, cellX, rowY + 5, { width: colW[i] - 4, lineBreak: false, ellipsis: true });
        cellX += colW[i];
      });
    });

    // Borde exterior de la tabla
    const tableH = ROW_H + sigs.length * ROW_H;
    doc
      .strokeColor(PDF_COLORS.border)
      .lineWidth(0.5)
      .rect(left, headerY, usable, tableH)
      .stroke();

    doc.fillColor(PDF_COLORS.ink);
    doc.y = headerY + tableH + 12;
  }

  private drawFooters(doc: PDFKit.PDFDocument, ctx: DocumentPdfContext) {
    const range = doc.bufferedPageRange();
    const e = ctx.emisor;
    const brand = e?.razonSocial ?? 'Kubo DevDocs';

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

      const origBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      try {
        doc
          .strokeColor(PDF_COLORS.border)
          .lineWidth(0.5)
          .moveTo(56, h - 70)
          .lineTo(w - 56, h - 70)
          .stroke();

        doc.font('Helvetica').fontSize(7.5).fillColor(PDF_COLORS.muted);
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

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(PDF_COLORS.muted);
        doc.text(
          `${brand}  ·  Página ${i + 1} de ${range.count}`,
          56,
          h - 36,
          { width: w - 112, align: 'center', lineBreak: false },
        );
      } finally {
        doc.page.margins.bottom = origBottom;
      }
    }
  }
}
