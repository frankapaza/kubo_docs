import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { reportsApi, type JiraIssueSummary, type JiraMonthlyReport } from '../api/reports.api';
import { projectsApi } from '../api/projects.api';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  RefreshIcon,
  SparklesIcon,
  ZapIcon,
} from '../components/ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

/**
 * Rango de mes: primer día hasta último día
 */
function monthRange(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const lastDay = new Date(y, m, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(firstDay), to: fmt(lastDay) };
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-PE', {
    month: 'long',
    year: 'numeric',
  });
}

export default function JiraReportPage() {
  const { projectId } = useParams();
  const pid = Number(projectId);
  const navigate = useNavigate();
  const [yearMonth, setYearMonth] = useState<string>(currentYearMonth());

  const { data: project } = useQuery({
    queryKey: ['project', pid],
    queryFn: () => projectsApi.findOne(pid),
    enabled: Number.isFinite(pid) && pid > 0,
  });

  const { from, to } = useMemo(() => monthRange(yearMonth), [yearMonth]);

  const {
    data: report,
    isFetching,
    refetch,
    error,
  } = useQuery({
    queryKey: ['jira-report', pid, from, to],
    queryFn: () => reportsApi.jiraMonthly({ projectId: pid, from, to }),
    enabled:
      Number.isFinite(pid) &&
      pid > 0 &&
      !!project?.jiraIntegrationId &&
      !!project?.jiraProjectKey,
    retry: false,
  });

  const generate = useMutation({
    mutationFn: () => reportsApi.generateDocument({ projectId: pid, from, to }),
    onSuccess: (data) => navigate(`/documents/${data.documentId}`),
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo generar el informe con IA'),
  });

  const monthLabel = formatMonthLabel(yearMonth);

  return (
    <div className="space-y-5">
      <div>
        <Link
          to={`/projects/${pid}/meetings`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeftIcon size={14} />
          Volver al proyecto
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-4 mt-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Informe mensual Jira</h1>
            <p className="text-sm text-slate-500 mt-1">
              {project?.name ? (
                <>
                  Proyecto <strong>{project.name}</strong>
                  {project.jiraProjectKey && (
                    <>
                      {' '}· Jira: <code className="font-mono text-xs bg-slate-100 px-1 rounded">{project.jiraProjectKey}</code>
                    </>
                  )}
                </>
              ) : (
                'Cargando proyecto…'
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="month"
              value={yearMonth}
              onChange={(e) => setYearMonth(e.target.value)}
              className="input !w-auto"
              style={{ maxWidth: 160 }}
            />
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshIcon size={14} />}
              onClick={() => refetch()}
              loading={isFetching}
            >
              Actualizar
            </Button>
            {report && (
              <Button
                size="sm"
                icon={<SparklesIcon size={14} />}
                onClick={async () => {
                  const ok = await askConfirm({
                    title: 'Generar informe con IA',
                    message: `¿Generar informe con IA para ${monthLabel}? Se guardará como documento del cliente.`,
                    confirmText: 'Generar',
                  });
                  if (ok) generate.mutate();
                }}
                loading={generate.isPending}
              >
                Generar informe con IA
              </Button>
            )}
          </div>
        </div>
      </div>

      {!project?.jiraIntegrationId || !project?.jiraProjectKey ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<ZapIcon size={22} />}
              title="Jira no está configurado para este proyecto"
              description="Vincula el proyecto con una integración Jira para ver el informe mensual."
              action={
                <Button onClick={() => navigate(`/projects/${pid}/members`)}>
                  Ir a configuración del proyecto
                </Button>
              }
            />
          </CardBody>
        </Card>
      ) : error ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<ZapIcon size={22} />}
              title="No se pudo cargar el informe"
              description={
                (error as { response?: { data?: { message?: string } } })?.response?.data
                  ?.message ?? 'Error consultando Jira. Verifica que la integración sea válida.'
              }
              action={
                <Button onClick={() => refetch()} icon={<RefreshIcon size={14} />}>
                  Reintentar
                </Button>
              }
            />
          </CardBody>
        </Card>
      ) : isFetching && !report ? (
        <Card>
          <CardBody>
            <div className="py-12 text-center text-sm text-slate-400">
              Consultando Jira… puede tardar unos segundos si hay muchos issues.
            </div>
          </CardBody>
        </Card>
      ) : report ? (
        <ReportDashboard report={report} monthLabel={monthLabel} />
      ) : null}
    </div>
  );
}

function ReportDashboard({
  report,
  monthLabel,
}: {
  report: JiraMonthlyReport;
  monthLabel: string;
}) {
  return (
    <div className="space-y-5">
      {/* Totales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Creados" value={report.totals.created} tone="info" icon={<FileTextIcon size={14} />} />
        <StatCard label="Resueltos" value={report.totals.resolved} tone="success" icon={<CheckIcon size={14} />} />
        <StatCard label="En progreso" value={report.totals.inProgress} tone="warning" icon={<ClockIcon size={14} />} />
        <StatCard label="Abiertos" value={report.totals.stillOpen} tone="neutral" icon={<FileTextIcon size={14} />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Por persona */}
        <Card className="lg:col-span-1">
          <CardHeader title="Actividad por persona" subtitle={`Mes de ${monthLabel}`} />
          <CardBody>
            {report.byAssignee.length === 0 ? (
              <p className="text-sm text-slate-400 italic">Sin actividad registrada.</p>
            ) : (
              <div className="space-y-2">
                {report.byAssignee.map((a) => (
                  <div
                    key={a.name}
                    className="flex items-center justify-between gap-2 px-3 py-2 border border-slate-100 rounded-lg"
                  >
                    <p className="text-sm font-medium text-slate-800 truncate flex-1">{a.name}</p>
                    <div className="flex items-center gap-2 text-xs flex-shrink-0">
                      <span className="text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">
                        +{a.created}
                      </span>
                      <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                        ✓ {a.resolved}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Por tipo */}
        <Card className="lg:col-span-1">
          <CardHeader title="Por tipo de issue" subtitle="Todos los issues tocados en el mes" />
          <CardBody>
            {report.byIssueType.length === 0 ? (
              <p className="text-sm text-slate-400 italic">Sin datos.</p>
            ) : (
              <div className="space-y-1.5">
                {report.byIssueType.map((t) => (
                  <BarRow key={t.name} label={t.name} value={t.count} max={report.byIssueType[0]?.count ?? 1} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Por estado */}
        <Card className="lg:col-span-1">
          <CardHeader title="Por estado" subtitle="Distribución actual" />
          <CardBody>
            {report.byStatus.length === 0 ? (
              <p className="text-sm text-slate-400 italic">Sin datos.</p>
            ) : (
              <div className="space-y-1.5">
                {report.byStatus.map((s) => (
                  <BarRow
                    key={s.status}
                    label={s.status}
                    value={s.count}
                    max={report.byStatus[0]?.count ?? 1}
                    tone={
                      /done|resolved|closed|cerrado|finalizado/i.test(s.status)
                        ? 'success'
                        : /progress|progreso|review/i.test(s.status)
                          ? 'warning'
                          : 'info'
                    }
                  />
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Listas de issues */}
      <IssuesList
        title="Issues resueltos en el periodo"
        icon={<CheckIcon size={16} className="text-emerald-500" />}
        issues={report.issuesResolved}
        emptyLabel="No se resolvió ningún issue en este rango."
      />
      <IssuesList
        title="Issues actualmente en progreso"
        icon={<ClockIcon size={16} className="text-amber-500" />}
        issues={report.issuesInProgress}
        emptyLabel="No hay issues en progreso en este momento."
      />
      <IssuesList
        title="Issues creados en el periodo"
        icon={<FileTextIcon size={16} className="text-sky-500" />}
        issues={report.issuesCreated}
        emptyLabel="No se crearon nuevos issues en este rango."
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: 'info' | 'success' | 'warning' | 'neutral';
  icon: React.ReactNode;
}) {
  const toneClass = {
    info: 'from-sky-50 to-sky-100 border-sky-200 text-sky-700',
    success: 'from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-700',
    warning: 'from-amber-50 to-amber-100 border-amber-200 text-amber-700',
    neutral: 'from-slate-50 to-slate-100 border-slate-200 text-slate-700',
  }[tone];
  return (
    <div className={`bg-gradient-to-br ${toneClass} border rounded-xl p-4`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider opacity-70">
        {icon}
        {label}
      </div>
      <div className="text-3xl font-bold mt-2">{value}</div>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  tone = 'info',
}: {
  label: string;
  value: number;
  max: number;
  tone?: 'info' | 'success' | 'warning';
}) {
  const pct = Math.max(6, Math.round((value / Math.max(1, max)) * 100));
  const barColor = {
    info: 'bg-sky-400',
    success: 'bg-emerald-400',
    warning: 'bg-amber-400',
  }[tone];
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-600 mb-0.5">
        <span className="truncate pr-2">{label}</span>
        <span className="font-semibold text-slate-700">{value}</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function IssuesList({
  title,
  icon,
  issues,
  emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  issues: JiraIssueSummary[];
  emptyLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? issues : issues.slice(0, 10);
  return (
    <Card>
      <CardHeader
        icon={icon}
        title={`${title} (${issues.length})`}
        action={
          issues.length > 10 ? (
            <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Ver menos' : `Ver todos (${issues.length})`}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="p-0">
        {issues.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-400 italic">{emptyLabel}</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visible.map((i) => (
              <a
                key={i.key}
                href={i.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition group"
              >
                <code className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded flex-shrink-0">
                  {i.key}
                </code>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 truncate group-hover:text-kubo-primary transition">
                    {i.title}
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                    <span>{i.issueType}</span>
                    <span>·</span>
                    <span>{i.assignee ?? 'Sin asignar'}</span>
                  </div>
                </div>
                <Badge tone="neutral">{i.status}</Badge>
                <ArrowRightIcon size={14} className="text-slate-300 group-hover:text-slate-600 transition flex-shrink-0" />
              </a>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
