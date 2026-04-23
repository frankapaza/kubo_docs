import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actasApi, meetingsApi } from '../api/meetings.api';
import { participantsApi } from '../api/participants.api';
import { projectsApi } from '../api/projects.api';
import { signaturesApi, ActaSignature } from '../api/signatures.api';
import type { BacklogEpic, BacklogResult } from '../api/types';
import { integrationsApi, type Integration, type JiraProject } from '../api/integrations.api';
import { useAuth } from '../auth/AuthContext';
import { canApproveActa, canManageUsers } from '../auth/permissions';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { ActaStatusBadge, Badge } from '../components/ui/Badge';
import { MarkdownPreview } from '../components/MarkdownPreview';
import {
  ArrowLeftIcon,
  CheckIcon,
  DownloadIcon,
  FileTextIcon,
  PenIcon,
  PrinterIcon,
  RefreshIcon,
  SaveIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
  ZapIcon,
} from '../components/ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

type ViewMode = 'split' | 'preview' | 'editor';

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('es-PE', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export default function ActaEditorPage() {
  const { actaId } = useParams();
  const aid = Number(actaId);
  const qc = useQueryClient();
  const { user } = useAuth();
  const canApprove = canApproveActa(user);
  const isAdmin = canManageUsers(user);

  const { data: acta } = useQuery({
    queryKey: ['acta', aid],
    queryFn: () => actasApi.findOne(aid),
  });

  const meetingId = acta?.meetingId;
  const { data: meeting } = useQuery({
    queryKey: ['meeting', meetingId],
    queryFn: () => meetingsApi.findOne(meetingId!),
    enabled: !!meetingId,
  });

  const { data: participants } = useQuery({
    queryKey: ['participants', meetingId],
    queryFn: () => participantsApi.list(meetingId!),
    enabled: !!meetingId,
  });

  const { data: signatures } = useQuery({
    queryKey: ['acta-signatures', aid],
    queryFn: () => signaturesApi.list(aid),
    enabled: !!aid,
  });

  const projectId = meeting?.projectId;
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.findOne(projectId!),
    enabled: !!projectId,
  });

  const [content, setContent] = useState('');
  const [view, setView] = useState<ViewMode>('split');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [backlog, setBacklog] = useState<BacklogResult | null>(null);
  const [backlogOpen, setBacklogOpen] = useState(false);
  useEffect(() => {
    if (acta?.contentMarkdown) setContent(acta.contentMarkdown);
  }, [acta?.contentMarkdown]);

  const save = useMutation({
    mutationFn: () => actasApi.update(aid, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['acta', aid] });
      setSavedMsg('Guardado');
      setTimeout(() => setSavedMsg(null), 2000);
    },
  });

  const submit = useMutation({
    mutationFn: () => actasApi.submitReview(aid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acta', aid] }),
  });

  const approve = useMutation({
    mutationFn: () => actasApi.approve(aid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acta', aid] }),
  });

  const regenerate = useMutation({
    mutationFn: () => actasApi.regenerate(aid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['acta', aid] });
      qc.invalidateQueries({ queryKey: ['acta-signatures', aid] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo regenerar el acta con IA'),
  });

  const generateBacklog = useMutation({
    mutationFn: () => actasApi.generateBacklog(aid),
    onSuccess: (data) => {
      setBacklog(data);
      setBacklogOpen(true);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo generar el backlog'),
  });

  const sign = useMutation({
    mutationFn: (participantId: number) => signaturesApi.sign(aid, participantId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acta-signatures', aid] }),
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo firmar'),
  });

  const revoke = useMutation({
    mutationFn: (sigId: number) => signaturesApi.revoke(aid, sigId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acta-signatures', aid] }),
  });

  const signatureByParticipant = useMemo(() => {
    const m = new Map<number, ActaSignature>();
    (signatures ?? []).forEach((s) => m.set(s.participantId, s));
    return m;
  }, [signatures]);

  const attendedParticipants = useMemo(
    () => (participants ?? []).filter((p) => p.attended),
    [participants],
  );

  if (!acta) {
    return (
      <Card>
        <div className="p-12 text-center text-sm text-slate-400">Cargando acta…</div>
      </Card>
    );
  }

  const readOnly = acta.status === 'APPROVED' || acta.status === 'EXPORTED';
  const canSignNow =
    acta.status === 'IN_REVIEW' || acta.status === 'APPROVED' || acta.status === 'EXPORTED';

  const handlePrint = () => window.print();

  return (
    <div className="space-y-6 print-root print-area">
      <div className="no-print">
        <Link
          to={`/meetings/${acta.meetingId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeftIcon size={14} />
          Volver a la reunión
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap mt-3">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">Acta #{acta.id}</h1>
              <ActaStatusBadge status={acta.status} />
            </div>
            <p className="text-sm text-slate-500 mt-1">
              Versión {acta.version} · {meeting?.title ?? `Reunión #${acta.meetingId}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {savedMsg && (
              <span className="text-xs text-emerald-600 font-medium mr-1">{savedMsg}</span>
            )}
            <Button
              variant="secondary"
              icon={<SaveIcon size={16} />}
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={readOnly}
            >
              Guardar
            </Button>
            {canApprove && acta.status === 'DRAFT' && (
              <Button
                variant="secondary"
                icon={<SparklesIcon size={16} />}
                onClick={async () => {
                  const ok = await askConfirm({
                    title: 'Regenerar acta con IA',
                    message: 'Se sobrescribirá el contenido actual y se incrementará la versión. ¿Continuar?',
                    confirmText: 'Regenerar',
                    tone: 'warning',
                  });
                  if (ok) regenerate.mutate();
                }}
                loading={regenerate.isPending}
              >
                Regenerar con IA
              </Button>
            )}
            <Button
              variant="secondary"
              icon={<ZapIcon size={16} />}
              onClick={() => {
                if (backlog) {
                  setBacklogOpen(true);
                } else {
                  generateBacklog.mutate();
                }
              }}
              loading={generateBacklog.isPending}
            >
              Generar Backlog
            </Button>
            <Button
              variant="primary"
              icon={<SendIcon size={16} />}
              onClick={() => submit.mutate()}
              loading={submit.isPending}
              disabled={acta.status !== 'DRAFT'}
            >
              Enviar a revisión
            </Button>
            {canApprove && (
              <Button
                variant="success"
                icon={<CheckIcon size={16} />}
                onClick={() => approve.mutate()}
                loading={approve.isPending}
                disabled={!['DRAFT', 'IN_REVIEW'].includes(acta.status)}
              >
                Aprobar
              </Button>
            )}
            <Button
              variant="secondary"
              icon={<PrinterIcon size={16} />}
              onClick={handlePrint}
            >
              Imprimir
            </Button>
            <Button
              variant="ghost"
              icon={<DownloadIcon size={16} />}
              onClick={() => actasApi.downloadPdf(acta.id)}
            >
              Descargar PDF
            </Button>
          </div>
        </div>

        <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
          {(['split', 'editor', 'preview'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md transition ${
                view === v
                  ? 'bg-kubo-primary-light text-kubo-primary-dark'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {v === 'split' ? 'Dividida' : v === 'editor' ? 'Edición' : 'Vista previa'}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`acta-split-grid grid gap-5 ${
          view === 'split' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
        }`}
      >
        {(view === 'split' || view === 'editor') && (
          <Card className="no-print">
            <CardHeader
              icon={<FileTextIcon size={18} />}
              title="Editor"
              subtitle={
                readOnly
                  ? 'Este acta ya está aprobada o exportada — solo lectura.'
                  : 'Markdown. Los cambios se guardan con el botón Guardar.'
              }
            />
            <CardBody className="p-0">
              <textarea
                className="w-full h-[calc(100vh-420px)] min-h-[420px] px-5 py-4 font-mono text-sm border-0 focus:outline-none focus:ring-0 resize-none bg-transparent"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                readOnly={readOnly}
                placeholder="Escribe el contenido del acta aquí…"
              />
            </CardBody>
          </Card>
        )}

        {(view === 'split' || view === 'preview') && (
          <Card className="acta-preview-card">
            <CardHeader
              icon={<FileTextIcon size={18} />}
              title="Vista previa"
              subtitle="Formato final del acta para revisión e impresión."
            />
            <CardBody className="acta-preview-body px-8 py-8 overflow-auto max-h-[calc(100vh-420px)] min-h-[420px] lg:max-h-none">
              {content.trim() ? (
                <MarkdownPreview source={content} />
              ) : (
                <p className="text-sm text-slate-400 italic">El acta no tiene contenido aún.</p>
              )}
            </CardBody>
          </Card>
        )}
      </div>

      <Card className="print-signatures">
        <CardHeader
          icon={<PenIcon size={18} />}
          title="Firmas digitales"
          subtitle={
            canSignNow
              ? 'Las firmas se registran como hash SHA-256 del contenido, versión y firmante.'
              : 'Las firmas se habilitan cuando el acta pasa a "En revisión".'
          }
        />
        <CardBody>
          {attendedParticipants.length === 0 ? (
            <p className="text-sm text-slate-400 italic">
              No hay participantes marcados como asistentes.
            </p>
          ) : (
            <div className="sig-grid grid grid-cols-1 md:grid-cols-2 gap-4">
              {attendedParticipants.map((p) => {
                const sig = signatureByParticipant.get(p.id);
                const isMe = !!p.userId && p.userId === user?.id;
                const canSignThis = canSignNow && !sig && (isMe || isAdmin);
                const canRevokeThis =
                  !!sig && !readOnly && (sig.signedByUser === user?.id || isAdmin);
                return (
                  <div
                    key={p.id}
                    className="border border-slate-200 rounded-lg p-4 bg-white"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 text-sm">{p.fullName}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {p.role ?? (p.userId ? 'Miembro del proyecto' : 'Invitado externo')}
                          {p.documentNumber ? ` · DNI: ${p.documentNumber}` : ''}
                        </p>
                      </div>
                      {sig ? (
                        <Badge tone="success" dot>
                          Firmado
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Pendiente</Badge>
                      )}
                    </div>

                    {sig ? (
                      <div className="mt-3 space-y-1.5">
                        <div className="text-[11px] text-slate-500 no-print">
                          <span className="font-medium text-slate-600">Hash:</span>{' '}
                          <code className="font-mono break-all">
                            {sig.signatureHash.slice(0, 16)}…{sig.signatureHash.slice(-8)}
                          </code>
                        </div>
                        <div className="text-xs text-slate-600">
                          Firmado el {formatDate(sig.signedAt)}
                        </div>
                        <div className="pt-2 border-t border-dashed border-slate-200 mt-2">
                          <div className="h-8 border-b border-slate-400" />
                          <p className="text-[10px] text-slate-500 mt-1 font-mono">
                            {sig.signerName}
                            {sig.signerDocument ? ` — ${sig.signerDocument}` : ''}
                          </p>
                        </div>
                        {canRevokeThis && (
                          <div className="no-print pt-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<XIcon size={14} />}
                              onClick={async () => {
                                const ok = await askConfirm({
                                  title: 'Revocar firma',
                                  message: '¿Revocar esta firma? La persona tendrá que firmar de nuevo.',
                                  confirmText: 'Revocar',
                                  tone: 'warning',
                                });
                                if (ok) revoke.mutate(sig.id);
                              }}
                            >
                              Revocar
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <div className="pt-4 border-t border-dashed border-slate-200">
                          <div className="h-8 border-b border-slate-400" />
                          <p className="text-[10px] text-slate-500 mt-1 italic">
                            Espacio para firma
                          </p>
                        </div>
                        {canSignThis && (
                          <div className="no-print">
                            <Button
                              size="sm"
                              variant="primary"
                              icon={<PenIcon size={14} />}
                              onClick={async () => {
                                const ok = await askConfirm({
                                  title: 'Firmar acta',
                                  message: `¿Firmar el acta como "${p.fullName}"? La firma queda registrada con hash SHA-256 y no se puede modificar.`,
                                  confirmText: 'Firmar',
                                });
                                if (ok) sign.mutate(p.id);
                              }}
                              loading={sign.isPending && sign.variables === p.id}
                            >
                              Firmar
                            </Button>
                          </div>
                        )}
                        {!canSignThis && !canSignNow && (
                          <p className="text-[11px] text-slate-400 italic no-print">
                            Envía el acta a revisión para habilitar las firmas.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <details className="no-print mt-5 text-xs text-slate-500">
            <summary className="cursor-pointer select-none flex items-center gap-1.5 hover:text-slate-700">
              <RefreshIcon size={12} />
              Sobre la firma digital y huella dactilar
            </summary>
            <p className="mt-2 leading-relaxed">
              Cada firma genera un hash SHA-256 sobre el contenido actual del acta, la versión, los
              datos del firmante y el timestamp. Si el acta cambia, la relación firma-versión queda
              inequívocamente asociada a la versión firmada.
            </p>
            <p className="mt-2 leading-relaxed">
              <strong>Huella dactilar (opcional):</strong> en navegadores compatibles se podría
              integrar WebAuthn (<code>navigator.credentials.create</code>) para vincular la firma
              al autenticador biométrico del dispositivo (Windows Hello, Touch ID, huella Android).
              Esto queda como mejora para una próxima iteración.
            </p>
          </details>
        </CardBody>
      </Card>

      {backlogOpen && backlog && (
        <BacklogModal
          actaId={aid}
          backlog={backlog}
          initialIntegrationId={project?.jiraIntegrationId ?? null}
          initialProjectKey={project?.jiraProjectKey ?? null}
          onClose={() => setBacklogOpen(false)}
          onRegenerate={() => generateBacklog.mutate()}
          regenerating={generateBacklog.isPending}
        />
      )}
    </div>
  );
}

const PRIORITY_STYLE = {
  Alta: 'bg-red-100 text-red-700',
  Media: 'bg-amber-100 text-amber-700',
  Baja: 'bg-slate-100 text-slate-600',
};

function BacklogModal({
  actaId,
  backlog,
  initialIntegrationId,
  initialProjectKey,
  onClose,
  onRegenerate,
  regenerating,
}: {
  actaId: number;
  backlog: BacklogResult;
  initialIntegrationId: number | null;
  initialProjectKey: string | null;
  onClose: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<number | ''>(
    initialIntegrationId ?? '',
  );
  const [selectedProject, setSelectedProject] = useState(initialProjectKey ?? '');
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ url: string; count: number } | null>(null);
  const usingProjectDefault =
    !!initialIntegrationId &&
    selectedIntegration === initialIntegrationId &&
    selectedProject === initialProjectKey;

  const totalStories = backlog.epics.reduce((acc, e) => acc + e.stories.length, 0);
  const totalTasks = backlog.epics.reduce(
    (acc, e) => acc + e.stories.reduce((a, s) => a + s.tasks.length, 0),
    0,
  );

  const openExport = async () => {
    setExportOpen(true);
    const list = await integrationsApi.list().catch(() => []);
    setIntegrations(list);
    if (initialIntegrationId) {
      setLoadingProjects(true);
      const ps = await integrationsApi.listProjects(initialIntegrationId).catch(() => []);
      setProjects(ps);
      setLoadingProjects(false);
    }
  };

  const handleIntegrationChange = async (id: number | '') => {
    setSelectedIntegration(id);
    setSelectedProject('');
    setProjects([]);
    if (id === '') return;
    setLoadingProjects(true);
    const list = await integrationsApi.listProjects(id).catch(() => []);
    setProjects(list);
    setLoadingProjects(false);
  };

  const handleExport = async () => {
    if (!selectedIntegration || !selectedProject) return;
    setExporting(true);
    try {
      const result = await integrationsApi.exportToJira(
        actaId,
        selectedIntegration as number,
        selectedProject,
        backlog,
      );
      const integration = integrations.find((i) => i.id === selectedIntegration);
      const baseUrl = integration?.workspaceUrl.replace(/\/$/, '') ?? '';
      setExportResult({
        url: `${baseUrl}/jira/software/projects/${selectedProject}/boards`,
        count: result.epicsCreated + result.storiesCreated + result.tasksCreated,
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message ?? 'No se pudo exportar a Jira');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-2xl bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <ZapIcon size={15} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900">Product Backlog generado</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {backlog.epics.length} épica{backlog.epics.length !== 1 ? 's' : ''} · {totalStories} historia{totalStories !== 1 ? 's' : ''} · {totalTasks} tarea{totalTasks !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => navigator.clipboard.writeText(JSON.stringify(backlog, null, 2))}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
            >
              Copiar JSON
            </button>
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition disabled:opacity-50"
            >
              {regenerating ? 'Generando…' : 'Regenerar'}
            </button>
            <button
              onClick={openExport}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#0052CC] text-white hover:bg-[#0747A6] transition font-medium"
            >
              Exportar a Jira
            </button>
            <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
              <XIcon size={16} />
            </button>
          </div>
        </div>

        {/* Jira export panel */}
        {exportOpen && (
          <div className="flex-shrink-0 border-b border-slate-200 bg-blue-50 px-6 py-4">
            {exportResult ? (
              <div className="flex items-center gap-3">
                <CheckIcon size={18} className="text-emerald-600 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-800">
                    ¡{exportResult.count} ítems creados en Jira!
                  </p>
                  <a
                    href={exportResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#0052CC] hover:underline"
                  >
                    Ver en Jira →
                  </a>
                </div>
                <button onClick={() => { setExportResult(null); setExportOpen(false); }} className="text-slate-400 hover:text-slate-700">
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-end gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Integración
                    {usingProjectDefault && (
                      <span className="ml-2 text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                        config del proyecto
                      </span>
                    )}
                  </label>
                  <select
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0052CC]"
                    value={selectedIntegration}
                    onChange={(e) =>
                      handleIntegrationChange(e.target.value === '' ? '' : Number(e.target.value))
                    }
                  >
                    <option value="">Selecciona integración…</option>
                    {integrations.map((i) => (
                      <option key={i.id} value={i.id}>{i.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Proyecto Jira</label>
                  <select
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0052CC] disabled:opacity-50"
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    disabled={!selectedIntegration || loadingProjects}
                  >
                    <option value="">
                      {loadingProjects ? 'Cargando proyectos…' : 'Selecciona proyecto…'}
                    </option>
                    {projects.map((p) => (
                      <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleExport}
                  disabled={!selectedIntegration || !selectedProject || exporting}
                  className="px-4 py-2 rounded-lg bg-[#0052CC] text-white text-sm font-medium hover:bg-[#0747A6] transition disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                >
                  {exporting ? 'Exportando…' : 'Exportar'}
                </button>
                <button onClick={() => setExportOpen(false)} className="text-slate-400 hover:text-slate-700 pb-1">
                  <XIcon size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {backlog.epics.length === 0 ? (
            <p className="text-sm text-slate-400 italic text-center py-12">
              No se encontraron ítems de backlog en el acta.
            </p>
          ) : (
            backlog.epics.map((epic, ei) => <EpicCard key={ei} epic={epic} />)
          )}
        </div>
      </div>
    </div>
  );
}

function EpicCard({ epic }: { epic: BacklogEpic }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-indigo-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-indigo-50 hover:bg-indigo-100 transition text-left"
      >
        <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider w-10 flex-shrink-0">
          ÉPICA
        </span>
        <span className="font-semibold text-indigo-900 flex-1 truncate">{epic.title}</span>
        <span className="text-xs text-indigo-500 flex-shrink-0">
          {epic.stories.length} historia{epic.stories.length !== 1 ? 's' : ''}
        </span>
        <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {epic.description && (
        <p className="px-4 pt-2 pb-1 text-xs text-slate-500 bg-indigo-50/60 border-b border-indigo-100">
          {epic.description}
        </p>
      )}
      {open && (
        <div className="divide-y divide-slate-100">
          {epic.stories.map((story, si) => (
            <StoryCard key={si} story={story} />
          ))}
        </div>
      )}
    </div>
  );
}

function StoryCard({ story }: { story: import('../api/types').BacklogStory }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition text-left"
      >
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5 w-6 flex-shrink-0">
          US
        </span>
        <span className="flex-1 text-sm text-slate-800 leading-snug">{story.title}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          {story.storyPoints !== null && (
            <span className="text-xs font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">
              {story.storyPoints}pt
            </span>
          )}
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_STYLE[story.priority]}`}
          >
            {story.priority}
          </span>
          <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 bg-slate-50 border-t border-slate-100">
          {story.description && (
            <p className="text-xs text-slate-600 pt-3">{story.description}</p>
          )}
          {story.assignee && (
            <p className="text-xs text-slate-500">
              <span className="font-medium">Responsable:</span> {story.assignee}
            </p>
          )}
          {story.acceptanceCriteria.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1.5">
                Criterios de aceptación
              </p>
              <ul className="space-y-1">
                {story.acceptanceCriteria.map((ac, i) => (
                  <li key={i} className="flex gap-2 text-xs text-slate-700">
                    <CheckIcon size={12} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                    {ac}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {story.tasks.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1.5">Tareas técnicas</p>
              <ul className="space-y-1">
                {story.tasks.map((t, i) => (
                  <li key={i} className="flex gap-2 text-xs text-slate-600">
                    <span className="text-slate-400 flex-shrink-0">□</span>
                    {t.title}
                    {t.assignee && (
                      <span className="text-slate-400 ml-auto flex-shrink-0">— {t.assignee}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
