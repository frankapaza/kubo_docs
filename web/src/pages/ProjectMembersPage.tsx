import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectMembersApi } from '../api/project-members.api';
import { projectsApi } from '../api/projects.api';
import { usersApi } from '../api/users.api';
import { useAuth } from '../auth/AuthContext';
import { canManageProjectMembers } from '../auth/permissions';
import type { ProjectMemberRole } from '../api/types';
import { ProjectJiraCard } from '../components/ProjectJiraCard';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge, RoleBadge } from '../components/ui/Badge';
import {
  ArrowLeftIcon,
  PlusIcon,
  RefreshIcon,
  UsersIcon,
  XIcon,
} from '../components/ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

const ROLE_IN_PROJECT: ProjectMemberRole[] = ['OWNER', 'EDITOR', 'VIEWER'];

const roleLabel: Record<ProjectMemberRole, string> = {
  OWNER: 'Owner',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
};

export default function ProjectMembersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canManage = canManageProjectMembers(user);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{ userId: string; roleInProject: ProjectMemberRole }>({
    userId: '',
    roleInProject: 'VIEWER',
  });

  const projectQ = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const list = await projectsApi.list();
      return list.data.find((p) => p.id === id) ?? null;
    },
    enabled: Number.isFinite(id) && id > 0,
  });

  const membersQ = useQuery({
    queryKey: ['project-members', id],
    queryFn: () => projectMembersApi.list(id),
    enabled: Number.isFinite(id) && id > 0,
  });

  const usersQ = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
    enabled: canManage,
  });

  const availableUsers = useMemo(() => {
    if (!usersQ.data) return [];
    const memberIds = new Set((membersQ.data ?? []).map((m) => m.userId));
    return usersQ.data.filter((u) => !memberIds.has(u.id) && u.isActive);
  }, [usersQ.data, membersQ.data]);

  const add = useMutation({
    mutationFn: (body: { userId: number; roleInProject: ProjectMemberRole }) =>
      projectMembersApi.add(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-members', id] });
      setShowForm(false);
      setForm({ userId: '', roleInProject: 'VIEWER' });
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message ?? 'No se pudo agregar el miembro');
    },
  });

  const remove = useMutation({
    mutationFn: (userId: number) => projectMembersApi.remove(id, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-members', id] }),
    onError: (e: { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message ?? 'No se pudo quitar al miembro');
    },
  });

  if (!Number.isFinite(id) || id <= 0) return <Navigate to="/projects" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.userId) return;
    add.mutate({ userId: Number(form.userId), roleInProject: form.roleInProject });
  };

  const members = membersQ.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowLeftIcon size={14} />}
          onClick={() => navigate('/projects')}
        >
          Volver a proyectos
        </Button>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Miembros del proyecto
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {projectQ.data
              ? `${projectQ.data.code} — ${projectQ.data.name}`
              : 'Cargando proyecto…'}
          </p>
        </div>
        {canManage && (
          <Button
            variant="primary"
            icon={<PlusIcon size={16} />}
            onClick={() => setShowForm((v) => !v)}
          >
            Agregar miembro
          </Button>
        )}
      </div>

      {canManage && showForm && (
        <Card>
          <form
            onSubmit={submit}
            className="p-5 grid grid-cols-1 md:grid-cols-[1fr_200px_auto] gap-3 items-end"
          >
            <div>
              <label className="label">Usuario</label>
              <select
                className="input"
                value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
                required
              >
                <option value="">Selecciona un usuario…</option>
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} — {u.email}
                  </option>
                ))}
              </select>
              {availableUsers.length === 0 && usersQ.data && (
                <p className="text-xs text-slate-400 mt-1">
                  Todos los usuarios activos ya son miembros.
                </p>
              )}
            </div>
            <div>
              <label className="label">Rol en el proyecto</label>
              <select
                className="input"
                value={form.roleInProject}
                onChange={(e) =>
                  setForm({
                    ...form,
                    roleInProject: e.target.value as ProjectMemberRole,
                  })
                }
              >
                {ROLE_IN_PROJECT.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel[r]}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" loading={add.isPending}>
              Agregar
            </Button>
          </form>
        </Card>
      )}

      <Card>
        {membersQ.isLoading ? (
          <div className="p-12 flex items-center justify-center text-slate-400">
            <RefreshIcon className="animate-spin" size={20} />
            <span className="ml-2 text-sm">Cargando miembros…</span>
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={24} />}
            title="Sin miembros"
            description="Agrega miembros para que puedan ver y gestionar este proyecto."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                  <th className="px-5 py-3">Usuario</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Rol global</th>
                  <th className="px-5 py-3">Rol en proyecto</th>
                  {canManage && <th className="px-5 py-3 text-right">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => (
                  <tr key={m.id} className="text-sm hover:bg-slate-50 transition">
                    <td className="px-5 py-4 font-medium text-slate-900">
                      {m.fullName}
                    </td>
                    <td className="px-5 py-4 text-slate-600">{m.email}</td>
                    <td className="px-5 py-4">
                      <RoleBadge role={m.globalRole} />
                    </td>
                    <td className="px-5 py-4">
                      <Badge tone={m.roleInProject === 'OWNER' ? 'primary' : 'neutral'}>
                        {roleLabel[m.roleInProject]}
                      </Badge>
                    </td>
                    {canManage && (
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<XIcon size={14} />}
                            onClick={async () => {
                              const ok = await askConfirm({
                                title: 'Quitar miembro',
                                message: `¿Quitar a ${m.fullName} del proyecto?`,
                                confirmText: 'Quitar',
                                tone: 'warning',
                              });
                              if (ok) remove.mutate(m.userId);
                            }}
                            loading={remove.isPending}
                          >
                            Quitar
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage && projectQ.data && (
        <ProjectJiraCard project={projectQ.data} />
      )}
    </div>
  );
}
