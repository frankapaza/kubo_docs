import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { projectsApi } from '../api/projects.api';
import { clientsApi } from '../api/clients.api';
import { useAuth } from '../auth/AuthContext';
import { canCreateProject } from '../auth/permissions';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ArchiveIcon,
  ArrowRightIcon,
  FolderIcon,
  PlusIcon,
  RefreshIcon,
  UsersIcon,
} from '../components/ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

type StatusFilter = 'ALL' | 'ACTIVE' | 'ARCHIVED';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canCreate = canCreateProject(user);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE');
  const [showForm, setShowForm] = useState(false);

  const prefillClientId = (location.state as { prefillClientId?: number } | null)?.prefillClientId;

  const { data, isLoading } = useQuery({
    queryKey: ['projects', statusFilter],
    queryFn: () => projectsApi.list({ status: statusFilter === 'ALL' ? undefined : statusFilter }),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => clientsApi.list(),
  });

  const [form, setForm] = useState<{
    code: string;
    jiraCode: string;
    name: string;
    description: string;
    clientId: number | '';
  }>({ code: '', jiraCode: '', name: '', description: '', clientId: prefillClientId ?? '' });

  useEffect(() => {
    if (prefillClientId) {
      setShowForm(true);
      setForm((f) => ({ ...f, clientId: prefillClientId }));
    }
  }, [prefillClientId]);

  const create = useMutation({
    mutationFn: () =>
      projectsApi.create({
        code: form.code,
        jiraCode: form.jiraCode || undefined,
        name: form.name,
        description: form.description || undefined,
        clientId: form.clientId === '' ? undefined : (form.clientId as number),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setForm({ code: '', jiraCode: '', name: '', description: '', clientId: '' });
      setShowForm(false);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo crear el proyecto'),
  });

  const clientById = new Map(clients.map((c) => [c.id, c]));

  const archive = useMutation({
    mutationFn: (id: number) => projectsApi.archive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
  const activate = useMutation({
    mutationFn: (id: number) => projectsApi.activate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Proyectos</h1>
          <p className="text-sm text-slate-500 mt-1">
            Gestiona los proyectos y sus reuniones.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm">
            {(['ACTIVE', 'ARCHIVED', 'ALL'] as StatusFilter[]).map((s) => {
              const label = s === 'ACTIVE' ? 'Activos' : s === 'ARCHIVED' ? 'Archivados' : 'Todos';
              const active = s === statusFilter;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition ${
                    active
                      ? 'bg-kubo-primary text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {canCreate && (
            <Button
              variant="primary"
              icon={<PlusIcon size={16} />}
              onClick={() => setShowForm((v) => !v)}
            >
              Nuevo proyecto
            </Button>
          )}
        </div>
      </div>

      {canCreate && showForm && (
        <Card>
          <form onSubmit={submit} className="p-5 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_1fr] gap-3">
              <div>
                <label className="label">Código</label>
                <input
                  className="input font-mono"
                  placeholder="KUBO-01"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Nombre</label>
                <input
                  className="input"
                  placeholder="Ej: Rediseño portal"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">
                  Cliente
                  {clients.length === 0 && (
                    <Link to="/clients" className="ml-2 text-xs text-kubo-primary hover:underline font-normal">
                      Crear primero →
                    </Link>
                  )}
                </label>
                <select
                  className="input"
                  value={form.clientId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      clientId: e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                >
                  <option value="">— Sin cliente —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.razonSocial}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
              <div>
                <label className="label">Código Jira (módulo)</label>
                <input
                  className="input font-mono uppercase"
                  maxLength={10}
                  placeholder="ej. VTA"
                  value={form.jiraCode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      jiraCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                    })
                  }
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Se combina con el código del cliente: [CE-{form.jiraCode || 'MOD'}]
                </p>
              </div>
              <div>
                <label className="label">Descripción (opcional)</label>
                <input
                  className="input"
                  placeholder="Breve resumen"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={create.isPending}>
                Crear proyecto
              </Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {isLoading ? (
          <div className="p-12 flex items-center justify-center text-slate-400">
            <RefreshIcon className="animate-spin" size={20} />
            <span className="ml-2 text-sm">Cargando proyectos…</span>
          </div>
        ) : data?.data.length === 0 ? (
          <EmptyState
            icon={<FolderIcon size={24} />}
            title="No hay proyectos"
            description={
              statusFilter === 'ARCHIVED'
                ? 'No tienes proyectos archivados.'
                : 'Crea tu primer proyecto para empezar a registrar reuniones.'
            }
            action={
              canCreate && statusFilter !== 'ARCHIVED' ? (
                <Button
                  variant="primary"
                  icon={<PlusIcon size={16} />}
                  onClick={() => setShowForm(true)}
                >
                  Crear proyecto
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                  <th className="px-5 py-3">Código</th>
                  <th className="px-5 py-3">Nombre</th>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.data.map((p) => {
                  const archived = p.status === 'ARCHIVED';
                  return (
                    <tr
                      key={p.id}
                      className={`text-sm transition hover:bg-slate-50 ${
                        archived ? 'opacity-60' : ''
                      }`}
                    >
                      <td className="px-5 py-4">
                        <code className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                          {p.code}
                        </code>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-medium text-slate-900">{p.name}</p>
                        {p.description && (
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                            {p.description}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {p.clientId && clientById.get(p.clientId) ? (
                          <Link
                            to={`/clients/${p.clientId}`}
                            className="text-sm text-slate-700 hover:text-kubo-primary hover:underline"
                          >
                            {clientById.get(p.clientId)!.razonSocial}
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Sin cliente</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <Badge tone={archived ? 'neutral' : 'success'} dot>
                          {archived ? 'Archivado' : 'Activo'}
                        </Badge>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {canCreate && (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<UsersIcon size={14} />}
                              onClick={() => navigate(`/projects/${p.id}/members`)}
                            >
                              Miembros
                            </Button>
                          )}
                          {canCreate &&
                            (archived ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => activate.mutate(p.id)}
                                loading={activate.isPending}
                              >
                                Reactivar
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<ArchiveIcon size={14} />}
                                onClick={async () => {
                                  const ok = await askConfirm({
                                    title: 'Archivar proyecto',
                                    message: `¿Archivar el proyecto "${p.name}"?`,
                                    confirmText: 'Archivar',
                                    tone: 'warning',
                                  });
                                  if (ok) archive.mutate(p.id);
                                }}
                                loading={archive.isPending}
                              >
                                Archivar
                              </Button>
                            ))}
                          <Button
                            size="sm"
                            variant="secondary"
                            trailingIcon={<ArrowRightIcon size={14} />}
                            onClick={() => navigate(`/projects/${p.id}/meetings`)}
                          >
                            Reuniones
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
