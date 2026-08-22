import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import type { Compliance, PortalMonthlyReport } from '../../api/types';
import { fmtDateOnly } from './PortalTicketsListPage';

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

/**
 * Mismo texto que pinta la pantalla (`PortalMonthlyReportPage.tsx`) cuando un
 * bloque viene con la lista vacía -- una sola fuente para las tres
 * superficies, para que no diverjan. Sin esto, un bloque vacío salía en el
 * PDF y el CSV como una tabla solo con encabezados, sin nada que explique
 * por qué: con los doce requerimientos que hay hoy en producción, todos
 * internos, el bloque de requerimientos sale vacío en todos los primeros
 * informes que un cliente descargue.
 */
export const TICKETS_EMPTY_MESSAGE = 'Ningún ticket en este periodo.';
export const REQUIREMENTS_EMPTY_MESSAGE = 'Ningún requerimiento pedido desde el portal en este periodo.';

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

/**
 * `createdAtLabel`/`closedAtLabel`, nunca `fmtDate` sobre el ISO: mismo
 * motivo que `ticketRows` -- `closedAt` es la fecha contra la que el backend
 * decide `commitment`, y `fmtDate` no pasa zona horaria (toma la del
 * navegador). Ver el JSDoc de `MonthlyReportRequirementRow` en
 * `../../api/types`.
 */
function requirementRows(report: PortalMonthlyReport): string[][] {
  return report.requirements!.rows.map((r, i) => [
    String(i + 1),
    r.code ?? `#${r.id}`,
    r.title,
    r.status,
    r.createdAtLabel,
    fmtDueDate(r.dueDate),
    r.closedAtLabel ?? '—',
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
    // Cada porcentaje va con sus dos contadores: sin ellos, «Cumplimiento de
    // respuesta: 100 %» no dice sobre cuántos se calculó -- justo lo que
    // este documento existe para justificar.
    lines.push(csvLine(['% cumplimiento de respuesta', fmtPercentForDocument(t.responseCompliancePercent)]));
    lines.push(csvLine(['Sin compromiso de respuesta', String(t.responseWithoutCommitment)]));
    lines.push(csvLine(['Aún no vence (respuesta)', String(t.responseNotYetDue)]));
    lines.push(csvLine(['% cumplimiento de resolución', fmtPercentForDocument(t.resolutionCompliancePercent)]));
    lines.push(csvLine(['Sin compromiso de resolución', String(t.withoutCommitment)]));
    lines.push(csvLine(['Aún no vence (resolución)', String(t.notYetDue)]));
    lines.push('');
    lines.push(csvLine(TICKETS_TABLE_HEAD));
    // Bloque con lista vacía: la misma frase que explica en pantalla por qué
    // no hay nada, no una tabla con solo encabezados.
    if (report.tickets.rows.length === 0) {
      lines.push(csvLine([TICKETS_EMPTY_MESSAGE]));
    } else {
      ticketRows(report).forEach((row) => lines.push(csvLine(row)));
    }
    lines.push('');
  }

  if (report.requirements) {
    const rq = report.requirements.totals;
    lines.push(csvLine(['Requerimientos']));
    lines.push(csvLine(['Solicitados', String(rq.requested)]));
    // «Aceptados» no es una cifra aparte de «Entregados»: los contiene (ver
    // `criteria`, que trae la misma aclaración impresa).
    lines.push(csvLine(['Aceptados', String(rq.accepted)]));
    lines.push(csvLine(['Entregados', String(rq.delivered)]));
    lines.push(csvLine(['Rechazados', String(rq.rejected)]));
    lines.push(csvLine(['% cumplimiento de compromiso', fmtPercentForDocument(rq.commitmentCompliancePercent)]));
    lines.push(csvLine(['Sin compromiso', String(rq.withoutCommitment)]));
    lines.push(csvLine(['Aún no vence', String(rq.notYetDue)]));
    lines.push('');
    lines.push(csvLine(REQUIREMENTS_TABLE_HEAD));
    if (report.requirements.rows.length === 0) {
      lines.push(csvLine([REQUIREMENTS_EMPTY_MESSAGE]));
    } else {
      requirementRows(report).forEach((row) => lines.push(csvLine(row)));
    }
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
    // Cada porcentaje con sus dos contadores al lado: sin ellos, «Cumplimiento
    // de respuesta: 100 %» no dice sobre cuántos se calculó -- ese número es
    // justo lo que este informe existe para justificar (ver `compliancePercent`
    // en el backend).
    doc.text(
      `% cumplimiento respuesta: ${fmtPercentForDocument(t.responseCompliancePercent)}   ` +
        `Sin compromiso de respuesta: ${t.responseWithoutCommitment}   ` +
        `Aún no vence (respuesta): ${t.responseNotYetDue}`,
      marginX,
      y,
    );
    y += 5;
    doc.text(
      `% cumplimiento resolución: ${fmtPercentForDocument(t.resolutionCompliancePercent)}   ` +
        `Sin compromiso de resolución: ${t.withoutCommitment}   ` +
        `Aún no vence (resolución): ${t.notYetDue}`,
      marginX,
      y,
    );
    y += 3;

    const sinTickets = report.tickets.rows.length === 0;
    autoTable(doc, {
      head: [TICKETS_TABLE_HEAD],
      // Bloque con lista vacía: la misma frase que explica en pantalla por
      // qué no hay nada, no una tabla huérfana con solo encabezados.
      body: sinTickets
        ? [[{ content: TICKETS_EMPTY_MESSAGE, colSpan: TICKETS_TABLE_HEAD.length, styles: { halign: 'center' as const, textColor: 130 } }]]
        : ticketRows(report),
      startY: y,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    });
    // `lastAutoTable` lo añade `jspdf-autotable` al objeto en tiempo de
    // ejecución; sus tipos no lo declaran (ver `jspdf-autotable/dist/index.d.ts`),
    // de ahí el `as any` puntual. `?.finalY` **y** `?? y`: el campo es
    // opcional en esos tipos, y sin la guarda una coordenada `NaN` borra el
    // bloque de requerimientos del PDF entero sin error, sin hueco y sin
    // aviso -- justo lo que se disparaba con el alcance AMBOS, el que viene
    // por defecto.
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;
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
    // «Aceptados» no es una cifra aparte de «Entregados»: los contiene (ver
    // `criteria`, que trae la misma aclaración impresa en el documento).
    doc.text(
      `Solicitados: ${rq.requested}   Aceptados: ${rq.accepted}   Entregados: ${rq.delivered}   ` +
        `Rechazados: ${rq.rejected}`,
      marginX,
      y,
    );
    y += 5;
    doc.text(
      `% cumplimiento de compromiso: ${fmtPercentForDocument(rq.commitmentCompliancePercent)}   ` +
        `Sin compromiso: ${rq.withoutCommitment}   Aún no vence: ${rq.notYetDue}`,
      marginX,
      y,
    );
    y += 3;

    const sinRequerimientos = report.requirements.rows.length === 0;
    autoTable(doc, {
      head: [REQUIREMENTS_TABLE_HEAD],
      body: sinRequerimientos
        ? [[{ content: REQUIREMENTS_EMPTY_MESSAGE, colSpan: REQUIREMENTS_TABLE_HEAD.length, styles: { halign: 'center' as const, textColor: 130 } }]]
        : requirementRows(report),
      startY: y,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    });
  }

  // Cabecera e identificación en cada página, y numeración -- con trece
  // columnas en A4 apaisado, cualquier cliente con actividad real hace que
  // la tabla salte de página, y sin esto las siguientes salían sin razón
  // social, sin periodo y sin numeración, en un documento cuyo propósito es
  // archivarse y reenviarse. La primera página ya lleva la cabecera completa
  // (razón social, periodo, generación y criterio); de la segunda en
  // adelante se repite una versión compacta.
  const totalPages = doc.getNumberOfPages();
  const compactHeader = `${report.clientName ?? 'Cliente'} · ${monthLabel(report.period.year, report.period.month)}`;
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    if (page > 1) {
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(compactHeader, marginX, 10);
    }
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Página ${page} de ${totalPages}`, pageWidth - marginX, pageHeight - 6, { align: 'right' });
    doc.setTextColor(0);
  }

  doc.save(`${fileBaseName(report)}.pdf`);
}
