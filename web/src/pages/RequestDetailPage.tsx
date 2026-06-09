import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientRequestsApi, UpdateClientRequestBody } from '../api/client-requests.api';
import { clientsApi } from '../api/clients.api';
import { projectsApi } from '../api/projects.api';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import {
  RequestPriorityBadge,
  RequestStatusBadge,
  RequestTypeBadge,
} from '../components/ui/Badge';
import {
  ArrowLeftIcon,
  CheckIcon,
  FileTextIcon,
  InfoIcon,
  LinkIcon,
  RefreshIcon,
  SparklesIcon,
  TrashIcon,
  UploadIcon,
} from '../components/ui/Icon';
import {
  CLIENT_REQUEST_PRIORITIES,
  CLIENT_REQUEST_PRIORITY_LABELS,
  CLIENT_REQUEST_TYPES,
  CLIENT_REQUEST_TYPE_LABELS,
  ClientRequest,
  ClientRequestPriority,
  ClientRequestType,
} from '../api/types';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

export default function RequestDetailPage() {
  const { requestId } = useParams();
  const rid = Number(requestId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: request, isLoading } = useQuery({
    queryKey: ['client-request', rid],
    queryFn: () => clientRequestsApi.findOne(rid),
    enabled: Number.isFinite(rid) && rid > 0,
  });

  const { data: clients } = useQuery({
    queryKey: ['clients-simple'],
    queryFn: () => clientsApi.list({ status: 'CLIENT' }),
  });
  const { data: projectsResp } = useQuery({
    queryKey: ['projects-simple'],
    queryFn: () => projectsApi.list({ status: 'ACTIVE' }),
  });
  const projects = projectsResp?.data ?? [];

  const structure = useMutation({
    mutationFn: () => clientRequestsApi.structure(rid),
    onSuccess: (r) => {
      qc.setQueryData(['client-request', rid], r);
      toast.success('Solicitud estructurada con IA.');
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo estructurar.'),
  });

  const update = useMutation({
    mutationFn: (body: UpdateClientRequestBody) => clientRequestsApi.update(rid, body),
    onSuccess: (r) => {
      qc.setQueryData(['client-request', rid], r);
      toast.success('Cambios guardados.');
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo actualizar.'),
  });

  const pushToJira = useMutation({
    mutationFn: () => clientRequestsApi.pushToJira(rid),
    onSuccess: (r) => {
      qc.setQueryData(['client-request', rid], r);
      toast.success(`Creado en Jira como ${r.jiraIssueKey}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo enviar a Jira.'),
  });

  const complete = useMutation({
    mutationFn: () => clientRequestsApi.complete(rid),
    onSuccess: ({ request, documentId }) => {
      qc.setQueryData(['client-request', rid], request);
      qc.invalidateQueries({ queryKey: ['client-requests'] });
      if (documentId) {
        toast.success(`Solicitud completada. Documento de cierre listo.`);
      } else {
        toast.success('Solicitud marcada como completada.');
      }
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo completar la solicitud.'),
  });

  if (isLoading || !request) {
    return (
      <Card>
        <div className="p-12 text-center text-sm text-slate-400">Cargando solicitud…</div>
      </Card>
    );
  }

  const isLocked = request.status === 'SENT' || request.status === 'COMPLETED';
  const client = request.clientId
    ? clients?.find((c) => c.id === request.clientId) ?? null
    : null;
  const project = request.projectId
    ? projects.find((p) => p.id === request.projectId) ?? null
    : null;

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/requests"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeftIcon size={14} />
          Volver a solicitudes
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap mt-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 line-clamp-2">
              {request.title ?? 'Solicitud sin estructurar'}
            </h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <RequestStatusBadge status={request.status} />
              <RequestTypeBadge type={request.requestType} />
              <RequestPriorityBadge priority={request.priority} />
              {request.jiraIssueKey && (
                <a
                  href={request.jiraIssueUrl ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:underline"
                >
                  <LinkIcon size={14} />
                  {request.jiraIssueKey}
                </a>
              )}
            </div>
          </div>
          {!isLocked && (
            <Button
              variant="ghost"
              icon={<TrashIcon size={16} />}
              onClick={async () => {
                const ok = await askConfirm({
                  title: 'Borrar solicitud',
                  message: '¿Seguro que quieres borrar esta solicitud? No se podrá recuperar.',
                  confirmText: 'Borrar',
                  tone: 'danger',
                });
                if (!ok) return;
                await clientRequestsApi.remove(rid);
                qc.invalidateQueries({ queryKey: ['client-requests'] });
                navigate('/requests');
              }}
            >
              Borrar
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          icon={<InfoIcon size={18} />}
          title="Texto original"
          subtitle={`Capturado el ${new Date(request.capturedAt).toLocaleString('es')} · ${request.source}`}
        />
        <CardBody>
          <pre className="whitespace-pre-wrap font-sans text-sm bg-slate-50 border border-slate-200 text-slate-700 p-4 rounded-lg leading-relaxed">
            {request.rawText}
          </pre>
        </CardBody>
      </Card>

      <InfoCard
        request={request}
        locked={request.status === 'COMPLETED' || request.status === 'ARCHIVED'}
        onSave={(patch) => update.mutate(patch)}
        saving={update.isPending}
      />

      {request.status === 'INBOX' ? (
        <Card className="border-2 border-indigo-100">
          <CardBody className="text-center py-8">
            <SparklesIcon size={28} className="text-kubo-primary mx-auto mb-3" />
            <h3 className="font-semibold text-slate-900 mb-1">Estructura con IA</h3>
            <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">
              Extrae título, módulo, pantalla, criterios de aceptación y labels. Podrás revisar y
              editar antes de enviar a Jira.
            </p>
            <Button
              variant="primary"
              icon={<SparklesIcon size={16} />}
              onClick={() => structure.mutate()}
              loading={structure.isPending}
            >
              Estructurar con IA
            </Button>
          </CardBody>
        </Card>
      ) : (
        <StructuredFieldsCard
          request={request}
          locked={isLocked}
          onSave={(patch) => update.mutate(patch)}
          saving={update.isPending}
          onRestructure={() => structure.mutate()}
          restructuring={structure.isPending}
        />
      )}

      <JiraTargetCard
        request={request}
        clientJiraCode={client?.jiraCode ?? null}
        projectJiraCode={project?.jiraCode ?? null}
        projectHasJiraLink={!!(project?.jiraIntegrationId && project?.jiraProjectKey)}
        onPush={() => pushToJira.mutate()}
        pushing={pushToJira.isPending}
        onChangeProject={(projectId) =>
          update.mutate({ projectId: projectId === null ? null : projectId })
        }
        onChangeClient={(clientId) =>
          update.mutate({ clientId: clientId === null ? null : clientId })
        }
        clients={clients ?? []}
        projects={projects}
      />

      {(request.status === 'INBOX' ||
        request.status === 'STRUCTURED' ||
        request.status === 'SENT') && (
        <Card className="border-2 border-emerald-100">
          <CardBody className="flex items-center justify-between gap-4 flex-wrap py-4">
            <div className="flex items-start gap-3">
              <CheckIcon size={20} className="text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-slate-900 text-sm">
                  {request.status === 'SENT'
                    ? 'Solicitud resuelta en Jira'
                    : 'Completar atención'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {request.status === 'SENT'
                    ? 'Se generará automáticamente un documento de cierre.'
                    : 'Marca esta atención como resuelta sin pasar por Jira. Se genera documento de cierre si tiene cliente asignado.'}
                </p>
              </div>
            </div>
            <Button
              variant="success"
              icon={<CheckIcon size={15} />}
              loading={complete.isPending}
              onClick={async () => {
                const ok = await askConfirm({
                  title: 'Completar atención',
                  message: `¿Confirmas que la atención "${request.title ?? 'esta solicitud'}" fue resuelta?`,
                  confirmText: 'Sí, completar',
                  tone: 'info',
                });
                if (ok) complete.mutate();
              }}
            >
              Completar atención
            </Button>
          </CardBody>
        </Card>
      )}

      {request.status === 'COMPLETED' && (
        <Card className="border-2 border-purple-100">
          <CardBody className="flex items-center justify-between gap-4 flex-wrap py-4">
            <div className="flex items-start gap-3">
              <CheckIcon size={20} className="text-purple-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-slate-900 text-sm">Solicitud completada</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Completada el{' '}
                  {request.completedAt
                    ? new Date(request.completedAt).toLocaleString('es')
                    : '—'}
                  {request.jiraIssueKey && ` · Jira: ${request.jiraIssueKey}`}
                </p>
              </div>
            </div>
            {request.closureDocumentId && (
              <a href={`/documents/${request.closureDocumentId}`}>
                <Button variant="secondary" icon={<FileTextIcon size={15} />}>
                  Ver documento de cierre
                </Button>
              </a>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Información general (nombre + fechas)
// ---------------------------------------------------------------------------

function toDateInput(val: string | null | undefined): string {
  if (!val) return '';
  return val.slice(0, 10);
}

function InfoCard({
  request,
  locked,
  onSave,
  saving,
}: {
  request: ClientRequest;
  locked: boolean;
  onSave: (patch: UpdateClientRequestBody) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(request.title ?? '');
  const [capturedAt, setCapturedAt] = useState(() => toDateInput(request.capturedAt));
  const [attendedAt, setAttendedAt] = useState(() => toDateInput(request.attendedAt));

  useEffect(() => {
    setTitle(request.title ?? '');
    setCapturedAt(toDateInput(request.capturedAt));
    setAttendedAt(toDateInput(request.attendedAt));
  }, [request]);

  const original = {
    title: request.title ?? '',
    capturedAt: toDateInput(request.capturedAt),
    attendedAt: toDateInput(request.attendedAt),
  };
  const changed =
    title !== original.title ||
    capturedAt !== original.capturedAt ||
    attendedAt !== original.attendedAt;

  const handleSave = () => {
    onSave({
      title: title.trim() || null,
      capturedAt: capturedAt ? `${capturedAt}T00:00:00` : undefined,
      attendedAt: attendedAt ? `${attendedAt}T00:00:00` : null,
    });
  };

  return (
    <Card>
      <CardHeader icon={<FileTextIcon size={18} />} title="Información de la atención" />
      <CardBody className="space-y-3">
        <div>
          <label className="label">Nombre</label>
          <input
            type="text"
            className="input"
            disabled={locked}
            placeholder="Nombre descriptivo de la atención"
            maxLength={240}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Fecha de inicio</label>
            <input
              type="date"
              className="input"
              disabled={locked}
              value={capturedAt}
              onChange={(e) => setCapturedAt(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Fecha de atención</label>
            <input
              type="date"
              className="input"
              disabled={locked}
              value={attendedAt}
              onChange={(e) => setAttendedAt(e.target.value)}
            />
          </div>
        </div>
        {!locked && (
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              disabled={!changed || saving}
              onClick={() => {
                setTitle(original.title);
                setCapturedAt(original.capturedAt);
                setAttendedAt(original.attendedAt);
              }}
            >
              Descartar
            </Button>
            <Button
              type="button"
              variant="primary"
              icon={<CheckIcon size={14} />}
              disabled={!changed || saving}
              loading={saving}
              onClick={handleSave}
            >
              Guardar
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Campos estructurados (editables)
// ---------------------------------------------------------------------------

function StructuredFieldsCard({
  request,
  locked,
  onSave,
  saving,
  onRestructure,
  restructuring,
}: {
  request: ClientRequest;
  locked: boolean;
  onSave: (patch: UpdateClientRequestBody) => void;
  saving: boolean;
  onRestructure: () => void;
  restructuring: boolean;
}) {
  const [draft, setDraft] = useState(() => projectDraft(request));
  useEffect(() => {
    setDraft(projectDraft(request));
  }, [request]);

  const changed = JSON.stringify(draft) !== JSON.stringify(projectDraft(request));

  const addCriterion = () =>
    setDraft({ ...draft, acceptanceCriteria: [...draft.acceptanceCriteria, ''] });
  const updateCriterion = (i: number, v: string) => {
    const arr = [...draft.acceptanceCriteria];
    arr[i] = v;
    setDraft({ ...draft, acceptanceCriteria: arr });
  };
  const removeCriterion = (i: number) => {
    const arr = draft.acceptanceCriteria.filter((_, idx) => idx !== i);
    setDraft({ ...draft, acceptanceCriteria: arr });
  };

  return (
    <Card>
      <CardHeader
        icon={<SparklesIcon size={18} />}
        title="Estructura para Jira"
        subtitle={locked ? 'Ya enviada — solo lectura' : 'Revisa y ajusta antes de enviar'}
        action={
          !locked && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshIcon size={14} />}
              onClick={onRestructure}
              loading={restructuring}
            >
              Re-estructurar
            </Button>
          )
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Tipo</label>
            <select
              className="input"
              disabled={locked}
              value={draft.requestType ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  requestType: (e.target.value as ClientRequestType) || null,
                })
              }
            >
              <option value="">(sin tipo)</option>
              {CLIENT_REQUEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CLIENT_REQUEST_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Prioridad</label>
            <select
              className="input"
              disabled={locked}
              value={draft.priority ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  priority: (e.target.value as ClientRequestPriority) || null,
                })
              }
            >
              <option value="">(sin prioridad)</option>
              {CLIENT_REQUEST_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {CLIENT_REQUEST_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Módulo</label>
            <input
              className="input"
              disabled={locked}
              value={draft.moduleName ?? ''}
              placeholder="ej. Venta"
              onChange={(e) => setDraft({ ...draft, moduleName: e.target.value || null })}
            />
          </div>
          <div>
            <label className="label">Pantalla</label>
            <input
              className="input"
              disabled={locked}
              value={draft.screenName ?? ''}
              placeholder="ej. Progresivo"
              onChange={(e) => setDraft({ ...draft, screenName: e.target.value || null })}
            />
          </div>
          <div>
            <label className="label">Flujo / disparador</label>
            <input
              className="input"
              disabled={locked}
              value={draft.flowContext ?? ''}
              placeholder="ej. Llamada entrante"
              onChange={(e) => setDraft({ ...draft, flowContext: e.target.value || null })}
            />
          </div>
        </div>

        <div>
          <label className="label">Título</label>
          <input
            className="input"
            disabled={locked}
            value={draft.title ?? ''}
            onChange={(e) => setDraft({ ...draft, title: e.target.value || null })}
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Se le agregará automáticamente el prefijo [CLIENTE-MÓDULO] al enviar a Jira.
          </p>
        </div>

        <div>
          <label className="label">Descripción (Markdown)</label>
          <textarea
            className="input min-h-[160px] font-mono text-xs"
            disabled={locked}
            value={draft.descriptionMd ?? ''}
            onChange={(e) => setDraft({ ...draft, descriptionMd: e.target.value || null })}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="label !mb-0">Criterios de aceptación</label>
            {!locked && (
              <button
                type="button"
                onClick={addCriterion}
                className="text-xs text-kubo-primary hover:text-kubo-primary-dark"
              >
                + Agregar
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {draft.acceptanceCriteria.length === 0 && (
              <p className="text-xs text-slate-400 italic">(ninguno)</p>
            )}
            {draft.acceptanceCriteria.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-slate-400">·</span>
                <input
                  className="input flex-1"
                  disabled={locked}
                  value={c}
                  onChange={(e) => updateCriterion(i, e.target.value)}
                />
                {!locked && (
                  <button
                    type="button"
                    onClick={() => removeCriterion(i)}
                    className="text-xs text-slate-400 hover:text-red-600 px-2"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Labels</label>
          <input
            className="input"
            disabled={locked}
            value={(draft.labels ?? []).join(', ')}
            placeholder="comma,separated,labels"
            onChange={(e) =>
              setDraft({
                ...draft,
                labels: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0),
              })
            }
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Al enviar a Jira se agregan automáticamente `cliente-*`, `tipo-*`, `modulo-*`,
            `pantalla-*` si aplica.
          </p>
        </div>

        {!locked && (
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              disabled={!changed || saving}
              onClick={() => setDraft(projectDraft(request))}
            >
              Descartar cambios
            </Button>
            <Button
              type="button"
              variant="primary"
              icon={<CheckIcon size={14} />}
              disabled={!changed || saving}
              loading={saving}
              onClick={() => onSave(toPatch(draft))}
            >
              Guardar cambios
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Destino Jira
// ---------------------------------------------------------------------------

function JiraTargetCard({
  request,
  clientJiraCode,
  projectJiraCode,
  projectHasJiraLink,
  onPush,
  pushing,
  onChangeClient,
  onChangeProject,
  clients,
  projects,
}: {
  request: ClientRequest;
  clientJiraCode: string | null;
  projectJiraCode: string | null;
  projectHasJiraLink: boolean;
  onPush: () => void;
  pushing: boolean;
  onChangeClient: (clientId: number | null) => void;
  onChangeProject: (projectId: number | null) => void;
  clients: { id: number; razonSocial: string; jiraCode: string | null }[];
  projects: { id: number; name: string; clientId: number | null; jiraCode: string | null; jiraIntegrationId: number | null; jiraProjectKey: string | null }[];
}) {
  const isSent = request.status === 'SENT';
  const canPush =
    !isSent &&
    request.status === 'STRUCTURED' &&
    !!request.title &&
    !!request.descriptionMd &&
    projectHasJiraLink;

  const filteredProjects = request.clientId
    ? projects.filter((p) => p.clientId === request.clientId)
    : projects;

  return (
    <Card>
      <CardHeader
        icon={<UploadIcon size={18} />}
        title="Destino en Jira"
        subtitle={
          isSent
            ? `Enviado como ${request.jiraIssueKey}`
            : 'Elige cliente y proyecto (vinculado a Jira) para enviar la solicitud'
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Cliente</label>
            <select
              className="input"
              disabled={isSent}
              value={request.clientId ?? ''}
              onChange={(e) => onChangeClient(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">(sin cliente)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razonSocial}
                  {c.jiraCode ? ` · ${c.jiraCode}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Código Jira del cliente: <strong>{clientJiraCode ?? '—'}</strong>
              {!clientJiraCode && ' (configúralo en el detalle del cliente)'}
            </p>
          </div>
          <div>
            <label className="label">Proyecto</label>
            <select
              className="input"
              disabled={isSent}
              value={request.projectId ?? ''}
              onChange={(e) => onChangeProject(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">(sin proyecto)</option>
              {filteredProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.jiraCode ? ` · ${p.jiraCode}` : ''}
                  {!p.jiraIntegrationId ? ' (sin Jira vinculado)' : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Código Jira del módulo: <strong>{projectJiraCode ?? '—'}</strong>
            </p>
          </div>
        </div>

        {!isSent && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
            <p className="font-medium mb-1">Título final preview:</p>
            <code className="text-slate-900">
              {previewTitle(request, clientJiraCode, projectJiraCode)}
            </code>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 flex-wrap">
          <p className="text-xs text-slate-500">
            {isSent
              ? 'Esta solicitud ya fue enviada.'
              : canPush
                ? 'Todo listo para enviar a Jira.'
                : 'Completa proyecto con Jira vinculado y estructura la solicitud para poder enviar.'}
          </p>
          {isSent ? (
            <a href={request.jiraIssueUrl ?? '#'} target="_blank" rel="noreferrer">
              <Button variant="secondary" icon={<LinkIcon size={14} />}>
                Abrir en Jira
              </Button>
            </a>
          ) : (
            <Button
              variant="success"
              icon={<UploadIcon size={16} />}
              disabled={!canPush}
              loading={pushing}
              onClick={onPush}
            >
              Enviar a Jira
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function previewTitle(
  req: ClientRequest,
  clientCode: string | null,
  moduleCode: string | null,
): string {
  const prefix =
    clientCode && moduleCode
      ? `[${clientCode}-${moduleCode}] `
      : clientCode
        ? `[${clientCode}] `
        : moduleCode
          ? `[${moduleCode}] `
          : '';
  const screen = req.screenName ? `${req.screenName}: ` : '';
  return `${prefix}${screen}${req.title ?? '(sin título)'}`;
}

interface Draft {
  requestType: ClientRequestType | null;
  priority: ClientRequestPriority | null;
  moduleName: string | null;
  screenName: string | null;
  flowContext: string | null;
  title: string | null;
  descriptionMd: string | null;
  acceptanceCriteria: string[];
  labels: string[];
}

function projectDraft(r: ClientRequest): Draft {
  return {
    requestType: r.requestType,
    priority: r.priority,
    moduleName: r.moduleName,
    screenName: r.screenName,
    flowContext: r.flowContext,
    title: r.title,
    descriptionMd: r.descriptionMd,
    acceptanceCriteria: r.acceptanceCriteria ?? [],
    labels: r.labels ?? [],
  };
}

function toPatch(d: Draft): UpdateClientRequestBody {
  return {
    requestType: d.requestType,
    priority: d.priority,
    moduleName: d.moduleName,
    screenName: d.screenName,
    flowContext: d.flowContext,
    title: d.title,
    descriptionMd: d.descriptionMd,
    acceptanceCriteria: d.acceptanceCriteria.filter((s) => s.trim().length > 0),
    labels: d.labels,
  };
}
