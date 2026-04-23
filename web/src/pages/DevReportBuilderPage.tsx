import { FormEvent, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { clientsApi } from '../api/clients.api';
import { projectsApi } from '../api/projects.api';
import { integrationsApi } from '../api/integrations.api';
import { reportsApi, type JiraSource, type MultiJiraReport } from '../api/reports.api';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ArrowLeftIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  PlusIcon,
  RefreshIcon,
  SparklesIcon,
  XIcon,
  ZapIcon,
} from '../components/ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

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

export default function DevReportBuilderPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const navigate = useNavigate();

  const [yearMonth, setYearMonth] = useState<string>(currentYearMonth());
  const [title, setTitle] = useState<string>('');
  const [context, setContext] = useState<string>('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [manualSources, setManualSources] = useState<JiraSource[]>([]);

  if (!Number.isFinite(cid) || cid <= 0) return <Navigate to="/clients" replace />;

  const { data: client } = useQuery({
    queryKey: ['client', cid],
    queryFn: () => clientsApi.findOne(cid),
  });

  // Proyectos Kubo de este cliente (de donde sacamos los Jira linkeados)
  const { data: projectsData } = useQuery({
    queryKey: ['client-projects', cid],
    queryFn: () => projectsApi.list({ clientId: cid }),
  });

  // Integraciones disponibles (para el "añadir manual")
  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationsApi.list,
  });

  // Derivamos la lista de fuentes Jira disponibles = proyectos Kubo con jiraIntegrationId + jiraProjectKey
  const availableSources: Array<
    JiraSource & { kuboProjectName: string; integrationLabel: string }
  > = useMemo(() => {
    const list = projectsData?.data ?? [];
    return list
      .filter((p) => p.jiraIntegrationId && p.jiraProjectKey)
      .map((p) => {
        const integration = integrations.find((i) => i.id === p.jiraIntegrationId);
        return {
          integrationId: Number(p.jiraIntegrationId),
          projectKey: p.jiraProjectKey as string,
          kuboProjectName: p.name,
          integrationLabel: integration?.label ?? `Integración ${p.jiraIntegrationId}`,
        };
      });
  }, [projectsData, integrations]);

  const keyFor = (s: JiraSource) => `${s.integrationId}|${s.projectKey}`;

  const toggleSource = (key: string) => {
    setSelectedKeys((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  const allSources: JiraSource[] = useMemo(() => {
    const auto = availableSources
      .filter((s) => selectedKeys.has(keyFor(s)))
      .map((s) => ({ integrationId: s.integrationId, projectKey: s.projectKey }));
    const manual = manualSources.filter(
      (m) => !auto.some((a) => a.integrationId === m.integrationId && a.projectKey === m.projectKey),
    );
    return [...auto, ...manual];
  }, [availableSources, selectedKeys, manualSources]);

  const { from, to } = useMemo(() => monthRange(yearMonth), [yearMonth]);

  // Vista previa (no generación IA todavía)
  const [preview, setPreview] = useState<MultiJiraReport | null>(null);
  const loadPreview = useMutation({
    mutationFn: () =>
      reportsApi.jiraMulti({
        clientId: cid,
        from,
        to,
        sources: allSources,
      }),
    onSuccess: (data) => setPreview(data),
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo consultar Jira'),
  });

  const generate = useMutation({
    mutationFn: () =>
      reportsApi.generateMultiDocument({
        clientId: cid,
        from,
        to,
        sources: allSources,
        title: title.trim() || undefined,
        additionalContext: context.trim() || undefined,
      }),
    onSuccess: (data) => navigate(`/documents/${data.documentId}`),
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo generar el documento'),
  });

  const canSubmit = allSources.length > 0 && !!from && !!to;

  const submitGenerate = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const ok = await askConfirm({
      title: 'Generar informe de desarrollo',
      message: `¿Generar informe con ${allSources.length} proyecto${allSources.length !== 1 ? 's' : ''} Jira para ${formatMonthLabel(yearMonth)}?`,
      confirmText: 'Generar',
    });
    if (!ok) return;
    generate.mutate();
  };

  return (
    <div className="space-y-5">
      <div>
        <Link
          to={`/clients/${cid}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeftIcon size={14} />
          Volver al cliente
        </Link>
        <div className="mt-3">
          <h1 className="text-2xl font-bold text-slate-900">Nuevo informe de desarrollo</h1>
          <p className="text-sm text-slate-500 mt-1">
            Consolida el avance de uno o varios proyectos Jira del cliente{' '}
            <strong>{client?.razonSocial ?? '…'}</strong> en un solo documento ejecutivo.
          </p>
        </div>
      </div>

      <form onSubmit={submitGenerate} className="space-y-4">
        {/* Paso 1 — Periodo */}
        <Card>
          <CardHeader
            icon={<ClockIcon size={18} />}
            title="1. Periodo"
            subtitle="Selecciona el mes a informar."
          />
          <CardBody>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="month"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
                className="input !w-auto"
                style={{ maxWidth: 180 }}
              />
              <span className="text-sm text-slate-600">
                Informe de <strong>{formatMonthLabel(yearMonth)}</strong> (del {from} al {to})
              </span>
            </div>
          </CardBody>
        </Card>

        {/* Paso 2 — Proyectos Jira */}
        <Card>
          <CardHeader
            icon={<ZapIcon size={18} />}
            title="2. Proyectos Jira a incluir"
            subtitle="Se auto-detectan los Jira linkeados a los proyectos Kubo del cliente. Puedes agregar más manualmente."
          />
          <CardBody>
            {availableSources.length === 0 && manualSources.length === 0 ? (
              <div className="space-y-3">
                <EmptyState
                  icon={<ZapIcon size={22} />}
                  title="No hay proyectos Jira vinculados"
                  description="Ninguno de los proyectos Kubo de este cliente tiene Jira configurado. Vincula un proyecto o agrega la fuente manualmente abajo."
                />
                {(projectsData?.data ?? []).length > 0 && (
                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                    <p className="text-xs font-semibold text-slate-600 mb-2">
                      Proyectos Kubo de este cliente — click en uno para vincularlo a Jira:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(projectsData?.data ?? []).map((p) => (
                        <Link
                          key={p.id}
                          to={`/projects/${p.id}/meetings`}
                          className="inline-flex items-center gap-2 text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-lg hover:border-kubo-primary hover:bg-kubo-primary-light transition"
                        >
                          <ZapIcon size={12} className="text-[#0052CC]" />
                          {p.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {availableSources.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Auto-detectados ({availableSources.length})
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {availableSources.map((s) => {
                        const k = keyFor(s);
                        const checked = selectedKeys.has(k);
                        return (
                          <label
                            key={k}
                            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                              checked
                                ? 'border-kubo-primary bg-kubo-primary-light'
                                : 'border-slate-200 hover:border-slate-300 bg-white'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={checked}
                              onChange={() => toggleSource(k)}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-900 truncate">
                                {s.kuboProjectName}
                              </p>
                              <p className="text-xs text-slate-500 font-mono mt-0.5">
                                {s.projectKey} · {s.integrationLabel}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Manual add */}
                <div className="pt-3 border-t border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Agregar manualmente (opcional)
                  </p>
                  <ManualSourceAdder
                    integrations={integrations}
                    existing={[
                      ...availableSources.map((a) => keyFor(a)),
                      ...manualSources.map((m) => keyFor(m)),
                    ]}
                    onAdd={(s) => setManualSources((prev) => [...prev, s])}
                  />
                  {manualSources.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {manualSources.map((m, idx) => (
                        <div
                          key={keyFor(m)}
                          className="flex items-center gap-2 text-xs px-2 py-1.5 bg-slate-50 rounded"
                        >
                          <Badge tone="info">
                            {integrations.find((i) => i.id === m.integrationId)?.label}
                          </Badge>
                          <code className="font-mono text-slate-700">{m.projectKey}</code>
                          <button
                            type="button"
                            onClick={() =>
                              setManualSources((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="ml-auto text-slate-400 hover:text-red-600"
                            title="Quitar"
                          >
                            <XIcon size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Resumen de seleccionados */}
            {allSources.length > 0 && (
              <div className="mt-4 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
                <CheckIcon size={14} />
                <span>
                  <strong>{allSources.length}</strong> proyecto
                  {allSources.length !== 1 ? 's' : ''} Jira seleccionado
                  {allSources.length !== 1 ? 's' : ''}. Se consolidarán en un único informe.
                </span>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Paso 3 — Vista previa */}
        <Card>
          <CardHeader
            icon={<RefreshIcon size={18} />}
            title="3. Vista previa (opcional)"
            subtitle="Consulta Jira antes de generar el informe con IA para validar los números."
            action={
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon={<RefreshIcon size={14} />}
                onClick={() => loadPreview.mutate()}
                disabled={!canSubmit}
                loading={loadPreview.isPending}
              >
                {preview ? 'Recargar preview' : 'Cargar vista previa'}
              </Button>
            }
          />
          <CardBody>
            {!preview ? (
              <p className="text-sm text-slate-400 italic">
                La vista previa muestra los totales consolidados y el detalle por proyecto antes de
                invocar la IA.
              </p>
            ) : (
              <PreviewSection preview={preview} />
            )}
          </CardBody>
        </Card>

        {/* Paso 4 — Título + contexto adicional */}
        <Card>
          <CardHeader
            icon={<FileTextIcon size={18} />}
            title="4. Título y contexto"
            subtitle="Opcionales. Sirven para que la IA ajuste tono o mencione algo específico."
          />
          <CardBody>
            <div className="space-y-3">
              <div>
                <label className="label">Título del documento</label>
                <input
                  type="text"
                  className="input"
                  placeholder={`Informe de desarrollo — ${client?.razonSocial ?? 'Cliente'} — ${formatMonthLabel(yearMonth)}`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Contexto adicional para la IA (opcional)</label>
                <textarea
                  className="input font-mono text-sm"
                  rows={3}
                  placeholder="Ej: mencionar que este mes tuvimos un incidente de producción que desvió a 2 devs 3 días"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Paso 5 — Generar */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            type="submit"
            icon={<SparklesIcon size={16} />}
            loading={generate.isPending}
            disabled={!canSubmit}
          >
            Generar informe con IA
          </Button>
          <Button variant="ghost" onClick={() => navigate(`/clients/${cid}`)}>
            Cancelar
          </Button>
          {!canSubmit && (
            <span className="text-xs text-amber-700">
              Selecciona al menos un proyecto Jira antes de generar.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function ManualSourceAdder({
  integrations,
  existing,
  onAdd,
}: {
  integrations: Array<{ id: number; label: string }>;
  existing: string[];
  onAdd: (s: JiraSource) => void;
}) {
  const [integrationId, setIntegrationId] = useState<number | ''>('');
  const [projectKey, setProjectKey] = useState('');

  const key = integrationId && projectKey ? `${integrationId}|${projectKey}` : '';
  const duplicate = existing.includes(key);

  const handleAdd = () => {
    if (!integrationId || !projectKey) return;
    if (duplicate) return;
    onAdd({ integrationId: integrationId as number, projectKey });
    setProjectKey('');
  };

  return (
    <div className="flex flex-wrap gap-2 items-end">
      <div className="flex-1 min-w-[160px]">
        <label className="text-xs text-slate-500 block mb-1">Integración</label>
        <select
          className="input"
          value={integrationId}
          onChange={(e) => setIntegrationId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">Selecciona…</option>
          {integrations.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-w-[120px]">
        <label className="text-xs text-slate-500 block mb-1">Project key</label>
        <input
          className="input font-mono"
          placeholder="KUBO"
          value={projectKey}
          onChange={(e) => setProjectKey(e.target.value.toUpperCase().trim())}
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        icon={<PlusIcon size={14} />}
        onClick={handleAdd}
        disabled={!integrationId || !projectKey || duplicate}
      >
        Agregar
      </Button>
      {duplicate && (
        <p className="text-xs text-amber-600 w-full">Ya está en la lista.</p>
      )}
    </div>
  );
}

function PreviewSection({ preview }: { preview: MultiJiraReport }) {
  return (
    <div className="space-y-4">
      {/* Totales consolidados */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatBox label="Creados" value={preview.combined.totals.created} tone="info" />
        <StatBox label="Resueltos" value={preview.combined.totals.resolved} tone="success" />
        <StatBox label="En progreso" value={preview.combined.totals.inProgress} tone="warning" />
        <StatBox label="Abiertos" value={preview.combined.totals.stillOpen} tone="neutral" />
      </div>

      {/* Por proyecto */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          Desglose por proyecto
        </p>
        <div className="space-y-1.5">
          {preview.sources.map((s) => (
            <div
              key={`${s.integrationId}|${s.projectKey}`}
              className="flex items-center justify-between gap-2 px-3 py-2 border border-slate-200 rounded-lg"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 font-mono">{s.projectKey}</p>
                <p className="text-xs text-slate-500">{s.integrationLabel}</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">
                  +{s.report.totals.created}
                </span>
                <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                  ✓ {s.report.totals.resolved}
                </span>
                <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                  ⋯ {s.report.totals.inProgress}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Por persona */}
      {preview.combined.byAssignee.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            Actividad consolidada por persona
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {preview.combined.byAssignee.map((a) => (
              <div
                key={a.name}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 border border-slate-100 rounded text-xs"
              >
                <span className="truncate flex-1">{a.name}</span>
                <span className="text-sky-700">+{a.created}</span>
                <span className="text-emerald-700">✓ {a.resolved}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'info' | 'success' | 'warning' | 'neutral';
}) {
  const cls = {
    info: 'bg-sky-50 border-sky-200 text-sky-700',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    warning: 'bg-amber-50 border-amber-200 text-amber-700',
    neutral: 'bg-slate-50 border-slate-200 text-slate-700',
  }[tone];
  return (
    <div className={`${cls} border rounded-lg p-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
