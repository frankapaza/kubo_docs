import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { reportsApi } from '../api/reports.api';
import { clientsApi } from '../api/clients.api';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { ServiceCategoryBadge } from '../components/ui/Badge';
import {
  ArrowLeftIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  RefreshIcon,
  SparklesIcon,
} from '../components/ui/Icon';
import { toast } from '../ui/Toast';
import type { MonthlyAttentionReport, MonthlyAttentionCategoryGroup, MonthlyTicketRow } from '../api/types';

// ---------------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------------

export interface ReportColumn {
  key: string;
  label: string;
  defaultOn: boolean;
}

export const REPORT_COLUMNS: ReportColumn[] = [
  { key: 'num',           label: '#',               defaultOn: true  },
  { key: 'title',         label: 'Nombre',           defaultOn: true  },
  { key: 'category',      label: 'Categoría',        defaultOn: true  },
  { key: 'requestType',   label: 'Tipo',             defaultOn: false },
  { key: 'status',        label: 'Estado',           defaultOn: true  },
  { key: 'capturedAt',    label: 'Fecha inicio',     defaultOn: true  },
  { key: 'attendedAt',    label: 'Fecha atención',   defaultOn: true  },
  { key: 'durationMinutes', label: 'Duración (min)', defaultOn: false },
  { key: 'priority',      label: 'Prioridad',        defaultOn: false },
];

const STATUS_LABELS: Record<string, string> = {
  INBOX: 'En bandeja', STRUCTURED: 'Estructurado',
  SENT: 'En Jira', COMPLETED: 'Completado', ARCHIVED: 'Archivado',
};
const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta',
};
const CATEGORY_LABELS: Record<string, string> = {
  SOFTWARE: 'Sistemas', SOPORTE: 'Soporte', CAPACITACION: 'Capacitación',
  CONSULTA: 'Consulta', ASESORIA: 'Asesoría', VISITA_SITIO: 'Visita en sitio',
  OTRO: 'Otro', SIN_CATEGORIA: 'Sin categoría',
};
const TYPE_LABELS: Record<string, string> = {
  BUG: 'Bug', MEJORA: 'Mejora', FEATURE: 'Feature', AJUSTE: 'Ajuste',
};

function fmtDate(val: string | null | undefined): string {
  if (!val) return '—';
  return new Date(val).toLocaleDateString('es-PE');
}

function getCellValue(col: string, ticket: MonthlyTicketRow, num: number, category: string): string {
  switch (col) {
    case 'num':             return String(num);
    case 'title':           return ticket.title ?? ticket.rawText.slice(0, 80);
    case 'category':        return CATEGORY_LABELS[category] ?? category;
    case 'requestType':     return ticket.requestType ? (TYPE_LABELS[ticket.requestType] ?? ticket.requestType) : '—';
    case 'status':          return STATUS_LABELS[ticket.status] ?? ticket.status;
    case 'capturedAt':      return fmtDate(ticket.capturedAt);
    case 'attendedAt':      return fmtDate(ticket.attendedAt);
    case 'durationMinutes': return ticket.durationMinutes ? `${ticket.durationMinutes} min` : '—';
    case 'priority':        return ticket.priority ? (PRIORITY_LABELS[ticket.priority] ?? ticket.priority) : '—';
    default:                return '—';
  }
}

function buildRows(report: MonthlyAttentionReport, activeCols: string[]) {
  const rows: string[][] = [];
  let num = 1;
  for (const grp of report.byCategory) {
    for (const t of grp.tickets) {
      rows.push(activeCols.map((col) => getCellValue(col, t, num, grp.category)));
      num++;
    }
  }
  return rows;
}

function exportCsv(report: MonthlyAttentionReport, activeCols: string[], monthLabel: string) {
  const headers = activeCols.map((k) => REPORT_COLUMNS.find((c) => c.key === k)!.label);
  const rows = buildRows(report, activeCols);
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  const bom = '﻿';
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Reporte_${report.clientName.replace(/\s+/g, '_')}_${monthLabel}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPdf(report: MonthlyAttentionReport, activeCols: string[], monthLabel: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const headers = activeCols.map((k) => REPORT_COLUMNS.find((c) => c.key === k)!.label);
  const rows = buildRows(report, activeCols);

  doc.setFontSize(14);
  doc.text(`Reporte mensual de atención — ${monthLabel}`, 14, 16);
  doc.setFontSize(10);
  doc.text(`Cliente: ${report.clientName}`, 14, 23);
  doc.text(
    `Total: ${report.totals.total}  |  Completadas: ${report.totals.completed}  |  Pendientes: ${report.totals.pending}`,
    14, 29,
  );

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 34,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  doc.save(`Reporte_${report.clientName.replace(/\s+/g, '_')}_${monthLabel}.pdf`);
}

// ---------------------------------------------------------------------------

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const lastDay = new Date(y, m, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(firstDay), to: fmt(lastDay) };
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
}

function fmtHours(minutes: number): string {
  if (minutes === 0) return '0h';
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  return min > 0 ? `${h}h ${min}min` : `${h}h`;
}

export default function MonthlyReportPage() {
  const { clientId } = useParams();
  const id = Number(clientId);
  const navigate = useNavigate();

  if (!Number.isFinite(id) || id <= 0) return <Navigate to="/clients" replace />;

  const [yearMonth, setYearMonth] = useState(currentYearMonth);
  const [report, setReport] = useState<MonthlyAttentionReport | null>(null);
  const [additionalContext, setAdditionalContext] = useState('');
  const [activeCols, setActiveCols] = useState<string[]>(
    () => REPORT_COLUMNS.filter((c) => c.defaultOn).map((c) => c.key),
  );
  const [showExport, setShowExport] = useState(false);

  const { data: client } = useQuery({
    queryKey: ['client', id],
    queryFn: () => clientsApi.findOne(id),
  });

  const fetchReport = useMutation({
    mutationFn: () => {
      const { from, to } = monthRange(yearMonth);
      return reportsApi.monthlyAttention({ clientId: id, from, to });
    },
    onSuccess: (data) => setReport(data),
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo obtener el reporte'),
  });

  const generateDoc = useMutation({
    mutationFn: () => {
      const { from, to } = monthRange(yearMonth);
      return reportsApi.generateMonthlyAttentionDocument({
        clientId: id,
        from,
        to,
        additionalContext: additionalContext.trim() || undefined,
      });
    },
    onSuccess: ({ documentId }) => {
      toast.success('Documento generado. Abriendo editor…');
      navigate(`/documents/${documentId}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo generar el documento'),
  });

  const monthLabel = formatMonthLabel(yearMonth);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            to={`/clients/${id}`}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-2"
          >
            <ArrowLeftIcon size={14} /> {client?.razonSocial ?? 'Cliente'}
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Reporte mensual de atención</h1>
          <p className="text-sm text-slate-500 mt-1">
            Genera el reporte de tickets del mes para revisión interna antes de remitirlo al cliente.
          </p>
        </div>
      </div>

      {/* Selector de mes */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="label">Período</label>
              <input
                type="month"
                className="input w-44"
                value={yearMonth}
                max={currentYearMonth()}
                onChange={(e) => {
                  setYearMonth(e.target.value);
                  setReport(null);
                }}
              />
            </div>
            <Button
              variant="primary"
              icon={<RefreshIcon size={15} />}
              loading={fetchReport.isPending}
              onClick={() => fetchReport.mutate()}
            >
              Generar reporte
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Resultados */}
      {report && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard label="Total atenciones" value={report.totals.total} tone="neutral" />
            <KpiCard label="Completadas" value={report.totals.completed} tone="success" />
            <KpiCard label="Pendientes" value={report.totals.pending} tone="warning" />
            <KpiCard
              label="Horas invertidas"
              value={fmtHours(report.totals.totalMinutes)}
              tone="info"
            />
          </div>

          {/* Exportar */}
          {report.totals.total > 0 && (
            <Card>
              <CardBody>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <p className="text-sm font-medium text-slate-700">Exportar reporte</p>
                  <button
                    type="button"
                    className="text-xs text-kubo-primary hover:underline"
                    onClick={() => setShowExport((v) => !v)}
                  >
                    {showExport ? 'Ocultar columnas ▲' : 'Seleccionar columnas ▼'}
                  </button>
                </div>

                {showExport && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    {REPORT_COLUMNS.map((col) => (
                      <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={activeCols.includes(col.key)}
                          onChange={(e) =>
                            setActiveCols((prev) =>
                              e.target.checked
                                ? [...prev, col.key]
                                : prev.filter((k) => k !== col.key),
                            )
                          }
                        />
                        <span className="text-slate-700">{col.label}</span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="secondary"
                    icon={<FileTextIcon size={15} />}
                    disabled={activeCols.length === 0}
                    onClick={() => exportCsv(report, activeCols, monthLabel)}
                  >
                    Descargar Excel (.csv)
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<FileTextIcon size={15} />}
                    disabled={activeCols.length === 0}
                    onClick={() => exportPdf(report, activeCols, monthLabel)}
                  >
                    Descargar PDF
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Resumen por categoría */}
          <Card>
            <CardHeader
              icon={<FileTextIcon size={18} />}
              title={`Atenciones — ${monthLabel}`}
              subtitle={`${report.totals.total} tickets · ${report.clientName}`}
            />
            <CardBody className="p-0">
              {report.byCategory.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  No hay tickets registrados en este período.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {report.byCategory.map((grp) => (
                    <CategorySection key={grp.category} group={grp} />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Generar documento */}
          {report.totals.total > 0 && (
            <Card className="border-2 border-indigo-100">
              <CardHeader
                icon={<SparklesIcon size={18} />}
                title="Generar documento editable"
                subtitle="La IA redacta la narrativa del reporte. Podrás revisarlo y ajustarlo antes de enviarlo al cliente."
              />
              <CardBody>
                <div className="space-y-3">
                  <div>
                    <label className="label">Contexto adicional para la IA (opcional)</label>
                    <textarea
                      className="input min-h-[80px] resize-y text-sm"
                      placeholder="Ej: Este mes hubo un incidente crítico el día 15 que requirió atención urgente. El cliente tiene una reunión de revisión el próximo lunes…"
                      value={additionalContext}
                      onChange={(e) => setAdditionalContext(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="primary"
                      icon={<SparklesIcon size={15} />}
                      loading={generateDoc.isPending}
                      onClick={() => generateDoc.mutate()}
                    >
                      Generar documento con IA
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: 'neutral' | 'success' | 'warning' | 'info';
}) {
  const colors = {
    neutral: 'bg-slate-50 border-slate-200',
    success: 'bg-emerald-50 border-emerald-200',
    warning: 'bg-amber-50 border-amber-200',
    info: 'bg-sky-50 border-sky-200',
  };
  const textColors = {
    neutral: 'text-slate-700',
    success: 'text-emerald-700',
    warning: 'text-amber-700',
    info: 'text-sky-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[tone]}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${textColors[tone]}`}>{value}</p>
    </div>
  );
}

function CategorySection({ group }: { group: MonthlyAttentionCategoryGroup }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <ServiceCategoryBadge category={group.category} />
          <span className="text-sm font-medium text-slate-700">
            {group.count} {group.count === 1 ? 'atención' : 'atenciones'}
          </span>
          <span className="text-xs text-emerald-600 flex items-center gap-1">
            <CheckIcon size={12} /> {group.completedCount} completadas
          </span>
          {group.totalMinutes > 0 && (
            <span className="text-xs text-sky-600 flex items-center gap-1">
              <ClockIcon size={12} /> {fmtHours(group.totalMinutes)}
            </span>
          )}
        </div>
        <span className="text-xs text-slate-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-left px-3 py-2 font-medium">#</th>
                <th className="text-left px-3 py-2 font-medium">Descripción</th>
                <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Tipo</th>
                <th className="text-left px-3 py-2 font-medium">Estado</th>
                <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Duración</th>
                <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {group.tickets.map((t, i) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-400 text-xs">{i + 1}</td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/requests/${t.id}`}
                      className="text-slate-800 hover:text-indigo-600 line-clamp-2"
                    >
                      {t.title ?? t.rawText.slice(0, 100)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell text-xs text-slate-500">
                    {t.requestType ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell text-xs text-slate-500">
                    {t.durationMinutes ? fmtHours(t.durationMinutes) : '—'}
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell text-xs text-slate-400">
                    {new Date(t.createdAt).toLocaleDateString('es-PE')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { label: string; cls: string }> = {
    COMPLETED: { label: 'Completado', cls: 'bg-emerald-100 text-emerald-700' },
    SENT: { label: 'En Jira', cls: 'bg-sky-100 text-sky-700' },
    STRUCTURED: { label: 'Estructurado', cls: 'bg-indigo-100 text-indigo-700' },
    ARCHIVED: { label: 'Archivado', cls: 'bg-slate-100 text-slate-500' },
    INBOX: { label: 'En bandeja', cls: 'bg-amber-100 text-amber-700' },
  };
  const { label, cls } = config[status] ?? { label: status, cls: 'bg-slate-100 text-slate-500' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}
