import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import type { MonthlyAttentionReport, MonthlyAttentionCategoryGroup } from '../api/types';

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
