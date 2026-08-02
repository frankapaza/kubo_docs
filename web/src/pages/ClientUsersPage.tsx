import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { clientsApi } from '../api/clients.api';
import { clientUsersApi, type ClientUser } from '../api/client-users.api';
import { useAuth } from '../auth/AuthContext';
import { canManageUsers } from '../auth/permissions';
import { Card, CardBody } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PlusIcon, RefreshIcon, UsersIcon } from '../components/ui/Icon';
import { toast } from '../ui/Toast';
import NewClientUserDialog from './client-users/NewClientUserDialog';
import EditClientUserDialog from './client-users/EditClientUserDialog';

function fmtDateTime(v: string | null): string {
  if (!v) return 'Nunca';
  return new Date(v).toLocaleString('es-PE');
}

export default function ClientUsersPage() {
  const { user: current } = useAuth();
  const qc = useQueryClient();

  const [clientId, setClientId] = useState<number | ''>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ClientUser | null>(null);

  // El picker necesita la lista completa de clientes, sin filtrar por estado
  // (a diferencia de NewTicketDialog, que solo ofrece clientes activos): un
  // usuario de un ex-cliente sigue existiendo y hay que poder verlo/editarlo.
  const { data: clients = [] } = useQuery({
    queryKey: ['clients-for-client-users-picker'],
    queryFn: () => clientsApi.list(),
    enabled: canManageUsers(current),
  });

  const {
    data: users,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['client-users', clientId],
    queryFn: () => clientUsersApi.listByClient(clientId as number),
    enabled: canManageUsers(current) && clientId !== '',
  });

  // Gate de página: mismo criterio que UsersPage. El backend además exige rol
  // ADMIN para crear y editar (`@Roles('ADMIN')` en client-users.controller.ts);
  // gatear aquí toda la pantalla evita construir una UI de permisos parciales
  // que no existe en ningún otro sitio del panel.
  if (!canManageUsers(current)) return <Navigate to="/clients" replace />;

  const selectedClient = clients.find((c) => c.id === clientId);

  const invalidateUsers = () => qc.invalidateQueries({ queryKey: ['client-users', clientId] });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Usuarios de clientes</h1>
          <p className="text-sm text-slate-500 mt-1">
            Cuentas con las que las empresas cliente entran al portal de soporte. El alta la hace
            siempre el equipo interno; no existe autorregistro.
          </p>
        </div>
        <Button
          icon={<PlusIcon size={16} />}
          onClick={() => setCreateOpen(true)}
          disabled={clientId === ''}
          title={clientId === '' ? 'Elige un cliente primero' : undefined}
        >
          Nuevo usuario
        </Button>
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <label className="label mb-0" htmlFor="client-users-picker">
            Cliente
          </label>
          <select
            id="client-users-picker"
            className="input max-w-sm"
            value={clientId}
            onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Elige un cliente…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.razonSocial}
              </option>
            ))}
          </select>
        </CardBody>
      </Card>

      <Card>
        {clientId === '' ? (
          <EmptyState
            icon={<UsersIcon size={22} />}
            title="Elige un cliente"
            description="El listado de usuarios del portal se pide siempre por empresa."
          />
        ) : isLoading ? (
          <div className="p-12 flex items-center justify-center text-slate-400">
            <RefreshIcon className="animate-spin" size={20} />
            <span className="ml-2 text-sm">Cargando usuarios…</span>
          </div>
        ) : isError ? (
          // Fallo de refresco, no de escritura: no se tocó nada, solo no se
          // pudo leer. Se distingue del fallo de alta/edición, que se muestra
          // dentro del propio diálogo.
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-red-600">No se pudo cargar la lista de usuarios.</p>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Reintentar
            </Button>
          </div>
        ) : !users || users.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={22} />}
            title="Sin usuarios todavía"
            description={`${selectedClient?.razonSocial ?? 'Este cliente'} no tiene usuarios del portal.`}
            action={
              <Button icon={<PlusIcon size={16} />} onClick={() => setCreateOpen(true)}>
                Dar de alta el primero
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                  <th className="px-5 py-3">Usuario</th>
                  <th className="px-5 py-3">Correo</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3">Último acceso</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="text-sm hover:bg-slate-50 transition">
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-900">{u.fullName}</p>
                      {u.isAdmin && (
                        <Badge tone="purple">Admin de la empresa</Badge>
                      )}
                    </td>
                    <td className="px-5 py-4 text-slate-600">{u.email}</td>
                    <td className="px-5 py-4">
                      <Badge tone={u.isActive ? 'success' : 'neutral'} dot>
                        {u.isActive ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-slate-500">{fmtDateTime(u.lastLoginAt)}</td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        className="text-sm font-medium text-kubo-primary hover:text-kubo-primary-dark transition"
                        onClick={() => setEditing(u)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewClientUserDialog
        open={createOpen}
        clientId={clientId === '' ? null : clientId}
        clientName={selectedClient?.razonSocial ?? ''}
        onCancel={() => setCreateOpen(false)}
        onCreated={invalidateUsers}
      />

      <EditClientUserDialog
        open={editing !== null}
        user={editing}
        onCancel={() => setEditing(null)}
        onUpdated={() => {
          setEditing(null);
          invalidateUsers();
          toast.success('Usuario actualizado');
        }}
      />
    </div>
  );
}
