import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import type { Compliance, PortalMonthlyReport } from '../../api/types';
import { fmtDate, fmtDateOnly } from './PortalTicketsListPage';

/**
 * Igual en las tres superficies (pantalla, PDF, CSV): `SIN_COMPROMISO` se
 * pinta literalmente como «Sin compromiso», nunca como un hueco ni como un
 * guion -- ver `Compliance` en `../../api/types` para el porqué.
 */
export const COMPLIANCE_LABELS: Record<Compliance, string> = {
  CUMPLIDO: 'Cumplido',
  INCUMPLIDO: 'Incumplido',
  SIN_COMPROMISO: 'Sin compromiso',
};

/**
 * Porcentaje de cumplimiento tal como debe pintarse: `null` es «—», nunca
 * `0 %`. El backend (`compliancePercent` en `domain/monthly-report.ts`)
 * ya decide cuándo no hubo nada medible; aquí solo se traduce ese `null` al
 * texto que exige la revisión, sin volver a decidir nada.
 */
export function fmtPercent(p: number | null): string {
  return p === null ? '—' : `${p}%`;
}

/**
 * Igual que `fmtPercent`, pero con la nota escrita al lado del «—» en vez de
 * dejarla aparte: en la pantalla ese guion vive junto a un texto pequeño que
 * ya avisa «sin compromisos que medir», pero en un documento -- lo que el
 * cliente archiva, reenvía o le enseña a un auditor -- una cifra sin ese
 * texto pegado al lado se vuelve ambigua otra vez. Sin esto un «—» a secas
 * en el PDF o el CSV se puede leer como «no cumplieron nada», que es
 * exactamente lo que esta regla existe para evitar.
 */
export function fmtPercentForDocument(p: number | null): string {
  return p === null ? '— (sin compromisos que medir)' : `${p}%`;
}

/** Marca de tiempo opcional (ISO, con hora) -- `fmtDate`, nunca `fmtDateOnly`, o desplaza el día. */
function fmtOptDate(v: string | null): string {
  return v ? fmtDate(v) : '—';
}

/**
 * Fecha comprometida de un requerimiento, o «—» si no hay ninguna (el
 * veredicto de la columna de cumplimiento, `SIN_COMPROMISO`, ya dice por
 * qué). `fmtDateOnly` y no `fmtDate`: es una columna `DATE`, sin hora --
 * confundirlas desplaza un día.
 */
export function fmtDueDate(v: string | null): string {
  return v ? fmtDateOnly(v) : '—';
}

/**
 * Etiqueta del periodo a partir de año y mes **numéricos** -- nunca
 * reconstruida a partir de una cadena ISO con `new Date(iso)`, que es la
 * misma trampa de zona horaria que ya mordió tres veces a este frontend.
 * `Date.UTC` más `timeZone: 'UTC'` en el formateador hacen que el resultado
 * no dependa de en qué zona esté el navegador de quien lo lee.
 */
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('es-PE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function fileBaseName(report: PortalMonthlyReport): string {
  const cliente = (report.clientName ?? 'Cliente').replace(/\s+/g, '_');
  const periodo = `${report.period.year}-${String(report.period.month).padStart(2, '0')}`;
  return `Informe_${cliente}_${periodo}`;
}

const TICKETS_TABLE_HEAD = [
  '#', 'Código', 'Asunto', 'Categoría', 'Prioridad', 'Estado',
  'Captura', '1ª respuesta', 'Resuelto', 'Vence respuesta', 'Vence resolución',
  'Cumpl. respuesta', 'Cumpl. resolución',
];

/**
 * Las cinco marcas de tiempo del ticket usan su `...Label`, nunca `fmtDate`
 * sobre el ISO: este documento existe para evidenciar cumplimiento de SLA, y
 * un veredicto («Incumplido») que no se puede verificar contra la hora
 * impresa al lado no prueba nada. El `...Label` ya viene del backend en hora
 * de Perú, con la hora y la zona escritas -- ver el JSDoc de
 * `MonthlyReportTicketRow` en `../../api/types`.
 */
function ticketRows(report: PortalMonthlyReport): string[][] {
  return report.tickets!.rows.map((r, i) => [
    String(i + 1),
    r.code ?? `#${r.id}`,
    r.subject ?? '—',
    r.category ?? '—',
    r.priority,
    r.status,
    r.capturedAtLabel,
    r.firstResponseAtLabel ?? '—',
    r.resolvedAtLabel ?? '—',
    r.slaResponseDueAtLabel ?? '—',
    r.slaResolutionDueAtLabel ?? '—',
    COMPLIANCE_LABELS[r.responseCompliance],
    COMPLIANCE_LABELS[r.resolutionCompliance],
  ]);
}

const REQUIREMENTS_TABLE_HEAD = [
  '#', 'Código', 'Título', 'Estado', 'Creado', 'Fecha comprometida', 'Cerrado', 'Cumplimiento',
];

function requirementRows(report: PortalMonthlyReport): string[][] {
  return report.requirements!.rows.map((r, i) => [
    String(i + 1),
    r.code ?? `#${r.id}`,
    r.title,
    r.status,
    fmtDate(r.createdAt),
    fmtDueDate(r.dueDate),
    fmtOptDate(r.closedAt),
    COMPLIANCE_LABELS[r.commitment],
  ]);
}

// ---------------------------------------------------------------------------
// CSV -- con BOM y separador de coma, como el que ya existe en
// `MonthlyReportPage.tsx`, para que Excel en español lo abra sin mojibake ni
// pegar todo en una sola columna.
// ---------------------------------------------------------------------------

function csvEscape(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

function csvLine(cells: string[]): string {
  return cells.map(csvEscape).join(',');
}

export function exportMonthlyReportCsv(report: PortalMonthlyReport): void {
  const lines: string[] = [];

  // Cabecera del documento: razón social, periodo, fecha y hora de
  // generación (`generatedAtLabel` tal cual, nunca reformateada) y el
  // criterio -- sin esto, el CSV no es evidencia de nada.
  lines.push(csvLine(['Informe mensual de servicio']));
  lines.push(csvLine(['Cliente', report.clientName ?? '—']));
  lines.push(csvLine(['Periodo', monthLabel(report.period.year, report.period.month)]));
  lines.push(csvLine(['Generado', report.generatedAtLabel]));
  lines.push(csvLine(['Criterio', report.criteria]));
  lines.push('');

  // Bloque `null`: no se escribe nada, ni siquiera un encabezado de sección
  // -- «no lo pediste» no es lo mismo que «no hubo nada».
  if (report.tickets) {
    const t = report.tickets.totals;
    lines.push(csvLine(['Tickets']));
    lines.push(csvLine(['Recibidos', String(t.received)]));
    lines.push(csvLine(['Resueltos', String(t.resolved)]));
    lines.push(csvLine(['Pendientes', String(t.pending)]));
    lines.push(csvLine(['Resueltos en el periodo', String(t.resolvedInPeriod)]));
    lines.push(csvLine(['% cumplimiento de respuesta', fmtPercentForDocument(t.responseCompliancePercent)]));
    lines.push(csvLine(['% cumplimiento de resolución', fmtPercentForDocument(t.resolutionCompliancePercent)]));
    lines.push(csvLine(['Sin compromiso de resolución', String(t.withoutCommitment)]));
    lines.push(csvLine(['Aún no vence', String(t.notYetDue)]));
    lines.push('');
    lines.push(csvLine(TICKETS_TABLE_HEAD));
    ticketRows(report).forEach((row) => lines.push(csvLine(row)));
    lines.push('');
  }

  if (report.requirements) {
    const rq = report.requirements.totals;
    lines.push(csvLine(['Requerimientos']));
    lines.push(csvLine(['Solicitados', String(rq.requested)]));
    lines.push(csvLine(['Aceptados', String(rq.accepted)]));
    lines.push(csvLine(['Entregados', String(rq.delivered)]));
    lines.push(csvLine(['Rechazados', String(rq.rejected)]));
    lines.push(csvLine(['% cumplimiento de compromiso', fmtPercentForDocument(rq.commitmentCompliancePercent)]));
    lines.push('');
    lines.push(csvLine(REQUIREMENTS_TABLE_HEAD));
    requirementRows(report).forEach((row) => lines.push(csvLine(row)));
  }

  const bom = '﻿';
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileBaseName(report)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// PDF -- jspdf + jspdf-autotable, mismo patrón que `MonthlyReportPage.tsx`.
// ---------------------------------------------------------------------------

export function exportMonthlyReportPdf(report: PortalMonthlyReport): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const marginX = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 16;

  doc.setFontSize(14);
  doc.text('Informe mensual de servicio', marginX, y);
  y += 7;

  doc.setFontSize(10);
  doc.text(`Cliente: ${report.clientName ?? '—'}`, marginX, y);
  y += 6;
  doc.text(`Periodo: ${monthLabel(report.period.year, report.period.month)}`, marginX, y);
  y += 6;
  // `generatedAtLabel` tal cual llega del backend, nunca reformateado aquí.
  doc.text(`Generado: ${report.generatedAtLabel}`, marginX, y);
  y += 6;

  const criteriaLines = doc.splitTextToSize(`Criterio: ${report.criteria}`, pageWidth - marginX * 2);
  doc.text(criteriaLines, marginX, y);
  y += criteriaLines.length * 4.5 + 5;

  if (report.tickets) {
    const t = report.tickets.totals;
    doc.setFontSize(12);
    doc.text('Tickets', marginX, y);
    y += 6;

    doc.setFontSize(9);
    doc.text(
      `Recibidos: ${t.received}   Resueltos: ${t.resolved}   Pendientes: ${t.pending}   ` +
        `Resueltos en el periodo: ${t.resolvedInPeriod}`,
      marginX,
      y,
    );
    y += 5;
    doc.text(
      `% cumplimiento respuesta: ${fmtPercentForDocument(t.responseCompliancePercent)}   ` +
        `% cumplimiento resolución: ${fmtPercentForDocument(t.resolutionCompliancePercent)}   ` +
        `Sin compromiso: ${t.withoutCommitment}   Aún no vence: ${t.notYetDue}`,
      marginX,
      y,
    );
    y += 3;

    autoTable(doc, {
      head: [TICKETS_TABLE_HEAD],
      body: ticketRows(report),
      startY: y,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    });
    // `lastAutoTable` lo añade `jspdf-autotable` al objeto en tiempo de
    // ejecución; sus tipos no lo declaran (ver `jspdf-autotable/dist/index.d.ts`),
    // de ahí el `as any` puntual.
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  if (report.requirements) {
    const rq = report.requirements.totals;

    // Salto de página si no queda espacio razonable para el título, los
    // totales y al menos una fila de la tabla del segundo bloque.
    if (y > pageHeight - 45) {
      doc.addPage();
      y = 16;
    }

    doc.setFontSize(12);
    doc.text('Requerimientos', marginX, y);
    y += 6;

    doc.setFontSize(9);
    doc.text(
      `Solicitados: ${rq.requested}   Aceptados: ${rq.accepted}   Entregados: ${rq.delivered}   ` +
        `Rechazados: ${rq.rejected}   % cumplimiento de compromiso: ${fmtPercentForDocument(rq.commitmentCompliancePercent)}`,
      marginX,
      y,
    );
    y += 3;

    autoTable(doc, {
      head: [REQUIREMENTS_TABLE_HEAD],
      body: requirementRows(report),
      startY: y,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    });
  }

  doc.save(`${fileBaseName(report)}.pdf`);
}
