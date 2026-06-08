import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientsApi, CreateClientBody } from '../api/clients.api';
import { projectsApi } from '../api/projects.api';
import { documentsApi } from '../api/documents.api';
import {
  CLIENT_STATUS_LABELS,
  CLIENT_STATUSES,
  COMMERCIAL_DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  type ClientStatus,
  type CommercialDocument,
  type CommercialDocumentStatus,
} from '../api/types';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ArrowLeftIcon,
  CalendarIcon,
  FileTextIcon,
  FolderIcon,
  PenIcon,
  PlusIcon,
  SaveIcon,
  UsersIcon,
  XIcon,
} from '../components/ui/Icon';
import { toast } from '../ui/Toast';

type Tab = 'summary' | 'projects' | 'documents';

const STATUS_TONE: Record<ClientStatus, 'neutral' | 'success' | 'info'> = {
  PROSPECT: 'info',
  CLIENT: 'success',
  FORMER_CLIENT: 'neutral',
};

export default function ClientDetailPage() {
  const { clientId } = useParams();
  const id = Number(clientId);
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('summary');

  if (!Number.isFinite(id) || id <= 0) return <Navigate to="/clients" replace />;

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => clientsApi.findOne(id),
  });

  const { data: projectsData } = useQuery({
    queryKey: ['client-projects', id],
    queryFn: () => projectsApi.list({ clientId: id }),
  });

  const { data: documentsList = [] } = useQuery({
    queryKey: ['client-documents', id],
    queryFn: () => documentsApi.list({ clientId: id }),
  });

  if (isLoading) {
    return (
      <Card>
        <div className="p-12 text-center text-sm text-slate-400">Cargando cliente…</div>
      </Card>
    );
  }
  if (!client) return <Navigate to="/clients" replace />;

  const projects = projectsData?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/clients"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeftIcon size={14} />
          Clientes
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-4 mt-3">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{client.razonSocial}</h1>
              <Badge tone={STATUS_TONE[client.status]}>{CLIENT_STATUS_LABELS[client.status]}</Badge>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-slate-500 flex-wrap">
              {client.ruc && (
                <span>
                  <span className="font-medium">RUC:</span>{' '}
                  <span className="font-mono">{client.ruc}</span>
                </span>
              )}
              {client.legalRepName && (
                <span>
                  <span className="font-medium">Rep.:</span> {client.legalRepName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-5 inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
          {(
            [
              { key: 'summary', label: 'Resumen' },
              { key: 'projects', label: `Proyectos${projects.length ? ` (${projects.length})` : ''}` },
              { key: 'documents', label: `Documentos${documentsList.length ? ` (${documentsList.length})` : ''}` },
            ] as { key: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-md transition ${
                tab === t.key
                  ? 'bg-kubo-primary-light text-kubo-primary-dark'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'summary' && <SummaryTab client={client} projectsCount={projects.length} documentsCount={documentsList.length} />}
      {tab === 'projects' && (
        <ProjectsTab
          projects={projects}
          clientName={client.razonSocial}
          onGoToProjects={() => navigate('/projects', { state: { prefillClientId: id } })}
        />
      )}
      {tab === 'documents' && (
        <DocumentsTab
          documents={documentsList}
          onNew={() => navigate(`/documents/new?clientId=${id}`)}
          onOpen={(docId) => navigate(`/documents/${docId}`)}
          onNewDevReport={() => navigate(`/clients/${id}/dev-report/new`)}
          onMonthlyReport={() => navigate(`/clients/${id}/monthly-report`)}
        />
      )}
    </div>
  );
}

function ProjectsTab({
  projects,
  clientName,
  onGoToProjects,
}: {
  projects: import('../api/types').Project[];
  clientName: string;
  onGoToProjects: () => void;
}) {
  return (
    <Card>
      <CardHeader
        icon={<FolderIcon size={18} />}
        title="Proyectos de este cliente"
        subtitle={`Proyectos activos o archivados asociados a ${clientName}`}
      />
      <CardBody>
        {projects.length === 0 ? (
          <EmptyState
            icon={<FolderIcon size={22} />}
            title="Sin proyectos todavía"
            description="Cuando crees un proyecto y lo vincules a este cliente, aparecerá aquí."
            action={
              <Button icon={<FolderIcon size={16} />} onClick={onGoToProjects}>
                Ir a Proyectos
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {projects.map((p) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}/meetings`}
                className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-indigo-200 hover:bg-slate-50 transition"
              >
                <FolderIcon size={18} className="text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 truncate">{p.name}</p>
                  <p className="text-xs text-slate-500 font-mono">{p.code}</p>
                </div>
                <Badge tone={p.status === 'ACTIVE' ? 'success' : 'neutral'}>
                  {p.status === 'ACTIVE' ? 'Activo' : 'Archivado'}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SummaryTab({ client, projectsCount, documentsCount }: { client: import('../api/types').Client; projectsCount: number; documentsCount: number }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CreateClientBody>({
    razonSocial: client.razonSocial,
    ruc: client.ruc ?? '',
    jiraCode: client.jiraCode ?? '',
    legalRepName: client.legalRepName ?? '',
    legalRepDoc: client.legalRepDoc ?? '',
    address: client.address ?? '',
    phone: client.phone ?? '',
    contactEmail: client.contactEmail ?? '',
    status: client.status,
    notes: client.notes ?? '',
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form };
      (Object.keys(payload) as (keyof CreateClientBody)[]).forEach((k) => {
        if (payload[k] === '') delete payload[k];
      });
      return clientsApi.update(client.id, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client', client.id] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      setEditing(false);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo actualizar el cliente'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
      <Card>
        <CardHeader
          icon={<UsersIcon size={18} />}
          title="Información del cliente"
          subtitle={editing ? 'Edita y guarda los cambios' : 'Datos legales y de contacto'}
          action={
            !editing ? (
              <Button size="sm" variant="ghost" icon={<PenIcon size={14} />} onClick={() => setEditing(true)}>
                Editar
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {!editing ? (
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <Row label="Razón social" value={client.razonSocial} />
              <Row label="RUC" value={client.ruc} mono />
              <Row label="Código Jira" value={client.jiraCode} mono />
              <Row label="Representante legal" value={client.legalRepName} />
              <Row label="DNI representante" value={client.legalRepDoc} mono />
              <Row label="Dirección" value={client.address} />
              <Row label="Teléfono" value={client.phone} />
              <Row label="Email" value={client.contactEmail} />
              <Row label="Estado" value={CLIENT_STATUS_LABELS[client.status]} />
              {client.notes && (
                <div className="md:col-span-2">
                  <dt className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Notas
                  </dt>
                  <dd className="text-slate-700 whitespace-pre-wrap">{client.notes}</dd>
                </div>
              )}
            </dl>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Razón social *</label>
                  <input
                    className="input"
                    value={form.razonSocial}
                    onChange={(e) => setForm({ ...form, razonSocial: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">RUC</label>
                  <input
                    className="input font-mono"
                    maxLength={11}
                    value={form.ruc ?? ''}
                    onChange={(e) => setForm({ ...form, ruc: e.target.value.replace(/\D/g, '') })}
                  />
                </div>
                <div>
                  <label className="label">Código Jira (prefijo)</label>
                  <input
                    className="input font-mono uppercase"
                    maxLength={10}
                    placeholder="ej. CE"
                    value={form.jiraCode ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        jiraCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                      })
                    }
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Se usa como prefijo [{form.jiraCode || '...'}] en los títulos de Jira.
                  </p>
                </div>
                <div>
                  <label className="label">Representante legal</label>
                  <input
                    className="input"
                    value={form.legalRepName ?? ''}
                    onChange={(e) => setForm({ ...form, legalRepName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">DNI representante</label>
                  <input
                    className="input font-mono"
                    value={form.legalRepDoc ?? ''}
                    onChange={(e) => setForm({ ...form, legalRepDoc: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="label">Dirección</label>
                  <input
                    className="input"
                    value={form.address ?? ''}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Teléfono</label>
                  <input
                    className="input"
                    value={form.phone ?? ''}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    className="input"
                    value={form.contactEmail ?? ''}
                    onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Estado</label>
                  <select
                    className="input"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as ClientStatus })}
                  >
                    {CLIENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {CLIENT_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="label">Notas internas</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={form.notes ?? ''}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" icon={<SaveIcon size={14} />} loading={save.isPending}>
                  Guardar cambios
                </Button>
                <Button
                  variant="ghost"
                  icon={<XIcon size={14} />}
                  onClick={() => {
                    setEditing(false);
                    setForm({
                      razonSocial: client.razonSocial,
                      ruc: client.ruc ?? '',
                      legalRepName: client.legalRepName ?? '',
                      legalRepDoc: client.legalRepDoc ?? '',
                      address: client.address ?? '',
                      phone: client.phone ?? '',
                      contactEmail: client.contactEmail ?? '',
                      status: client.status,
                      notes: client.notes ?? '',
                    });
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Resumen de actividad" subtitle="Visión rápida del cliente" />
        <CardBody>
          <div className="space-y-3">
            <StatRow icon={<FolderIcon size={14} />} label="Proyectos" value={projectsCount} />
            <StatRow icon={<FileTextIcon size={14} />} label="Documentos" value={documentsCount} />
            <StatRow
              icon={<CalendarIcon size={14} />}
              label="Cliente desde"
              value={new Date(client.createdAt).toLocaleDateString('es-PE', {
                dateStyle: 'medium',
              })}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

const DOC_STATUS_TONE: Record<CommercialDocumentStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SENT: 'info',
  SIGNED: 'success',
  EXPIRED: 'warning',
  CANCELLED: 'danger',
};

function DocumentsTab({
  documents,
  onNew,
  onOpen,
  onNewDevReport,
  onMonthlyReport,
}: {
  documents: CommercialDocument[];
  onNew: () => void;
  onOpen: (id: number) => void;
  onNewDevReport: () => void;
  onMonthlyReport: () => void;
}) {
  return (
    <Card>
      <CardHeader
        icon={<FileTextIcon size={18} />}
        title="Documentos comerciales"
        subtitle="NDAs, cotizaciones, contratos e informes generados para este cliente"
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<FileTextIcon size={14} />}
              onClick={onMonthlyReport}
              title="Reporte mensual de atención — tickets del mes por categoría"
            >
              Reporte mensual
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<FileTextIcon size={14} />}
              onClick={onNewDevReport}
              title="Informe de desarrollo — consolida varios proyectos Jira"
            >
              Informe de desarrollo
            </Button>
            <Button size="sm" icon={<PlusIcon size={14} />} onClick={onNew}>
              Nuevo documento
            </Button>
          </div>
        }
      />
      <CardBody>
        {documents.length === 0 ? (
          <EmptyState
            icon={<FileTextIcon size={22} />}
            title="Sin documentos todavía"
            description="Genera una cotización o contrato usando las plantillas disponibles."
            action={
              <Button icon={<PlusIcon size={16} />} onClick={onNew}>
                Nuevo documento
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {documents.map((d) => (
              <button
                key={d.id}
                onClick={() => onOpen(d.id)}
                className="w-full text-left flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-indigo-200 hover:bg-slate-50 transition"
              >
                <FileTextIcon size={18} className="text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 truncate">{d.title}</p>
                  <p className="text-xs text-slate-500">
                    {DOCUMENT_TYPE_LABELS[d.type]} · v{d.version} ·{' '}
                    {new Date(d.createdAt).toLocaleDateString('es-PE', { dateStyle: 'medium' })}
                  </p>
                </div>
                <Badge tone={DOC_STATUS_TONE[d.status]} dot>
                  {COMMERCIAL_DOCUMENT_STATUS_LABELS[d.status]}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
        {label}
      </dt>
      <dd className={`text-slate-700 ${mono ? 'font-mono' : ''}`}>
        {value || <span className="text-slate-400 italic">—</span>}
      </dd>
    </div>
  );
}

function StatRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
      <span className="inline-flex items-center gap-2 text-xs text-slate-500">
        {icon}
        {label}
      </span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}
