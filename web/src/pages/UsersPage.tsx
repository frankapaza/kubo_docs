import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { usersApi } from '../api/users.api';
import { useAuth } from '../auth/AuthContext';
import { canManageUsers, ROLE_OPTIONS } from '../auth/permissions';
import type { UserRole } from '../api/types';
import { Card } from '../components/ui/Card';
import { RoleBadge, roleLabels } from '../components/ui/Badge';
import { RefreshIcon, UsersIcon } from '../components/ui/Icon';
import { EmptyState } from '../components/ui/EmptyState';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';
import SupportAgentsSection from './tickets/SupportAgentsSection';

export default function UsersPage() {
  const { user: current } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
    enabled: canManageUsers(current),
  });

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: UserRole }) =>
      usersApi.updateRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e: { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message ?? 'No se pudo cambiar el rol');
    },
  });

  if (!canManageUsers(current)) return <Navigate to="/projects" replace />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Usuarios</h1>
        <p className="text-sm text-slate-500 mt-1">
          Gestiona los roles de los miembros del equipo.
        </p>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-12 flex items-center justify-center text-slate-400">
            <RefreshIcon className="animate-spin" size={20} />
            <span className="ml-2 text-sm">Cargando usuarios…</span>
          </div>
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={24} />}
            title="No hay usuarios"
            description="Todavía no hay cuentas registradas."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                  <th className="px-5 py-3">Usuario</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Rol actual</th>
                  <th className="px-5 py-3">Cambiar a</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((u) => {
                  const isSelf = current?.id === u.id;
                  return (
                    <tr key={u.id} className="text-sm hover:bg-slate-50 transition">
                      <td className="px-5 py-4">
                        <p className="font-medium text-slate-900">{u.fullName}</p>
                        {isSelf && (
                          <p className="text-xs text-slate-400 mt-0.5">(tú)</p>
                        )}
                      </td>
                      <td className="px-5 py-4 text-slate-600">{u.email}</td>
                      <td className="px-5 py-4">
                        <RoleBadge role={u.role} />
                      </td>
                      <td className="px-5 py-4">
                        <select
                          className="input max-w-[200px]"
                          value={u.role}
                          disabled={updateRole.isPending}
                          onChange={async (e) => {
                            const role = e.target.value as UserRole;
                            if (role === u.role) return;
                            const ok = await askConfirm({
                              title: 'Cambiar rol',
                              message: `¿Cambiar rol de ${u.fullName} a ${roleLabels[role]}?`,
                              confirmText: 'Cambiar',
                            });
                            if (ok) updateRole.mutate({ id: u.id, role });
                          }}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              {roleLabels[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div>
        <h2 className="text-lg font-semibold text-slate-900">Técnicos de la mesa</h2>
        <p className="text-sm text-slate-500 mt-1">
          Usuarios registrados como técnicos de soporte, su nivel, especialidades y la carga de
          tickets abiertos que alimenta la sugerencia automática de asignatario.
        </p>
      </div>
      <SupportAgentsSection />
    </div>
  );
}
