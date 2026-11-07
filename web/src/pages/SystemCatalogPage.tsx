import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { systemsApi } from '../api/tickets.api';
import type { System } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { canManageSystemCatalog } from '../auth/permissions';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { CheckIcon, PenIcon, PlusIcon, SettingsIcon, TrashIcon, XIcon } from '../components/ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

type ApiError = { response?: { data?: { message?: string } } };

/**
 * Los errores del backend (nombre repetido, «está asignado a algún cliente…»)
 * vienen escritos en español y dicen qué hacer en su lugar: se enseñan tal
 * cual.
 */
const apiMessage = (e: ApiError, fallback: string) => e.response?.data?.message ?? fallback;

/**
 * El catálogo de sistemas: los productos que la casa arrienda, uno para todos
 * los clientes. Aquí se dan de alta, se renombran, se retiran y se borran; a
 * cada cliente se le asignan desde la pestaña «Sistemas» de su ficha.
 *
 * Quien no es ADMIN la ve de solo lectura --sin campo de alta y sin botones--,
 * igual que la pestaña «Sistemas» del cliente: la guarda del servidor es la que
 * manda, y la pantalla no ofrece botones que siempre responden 403.
 */
export default function SystemCatalogPage() {
  const { user } = useAuth();
  const canManage = canManageSystemCatalog(user);
  const qc = useQueryClient();

  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  const { data: systems = [], isLoading, isError } = useQuery({
    queryKey: ['systems'],
    queryFn: systemsApi.list,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['systems'] });

  const create = useMutation({
    mutationFn: (name: string) => systemsApi.create({ name }),
    onSuccess: () => {
      setNewName('');
      refresh();
    },
    onError: (e: ApiError) => toast.error(apiMessage(e, 'No se pudo dar de alta el sistema')),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { name?: string; isActive?: boolean } }) =>
      systemsApi.update(id, body),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: (e: ApiError) => toast.error(apiMessage(e, 'No se pudo actualizar el sistema')),
  });

  const remove = useMutation({
    mutationFn: (id: number) => systemsApi.remove(id),
    onSuccess: refresh,
    onError: (e: ApiError) => toast.error(apiMessage(e, 'No se pudo borrar el sistema')),
  });

  const busy = create.isPending || update.isPending || remove.isPending;

  const submitNew = (e: FormEvent) => {
    e.preventDefault();
    if (newName.trim()) create.mutate(newName.trim());
  };

  const submitRename = (e: FormEvent) => {
    e.preventDefault();
    if (editing && editing.name.trim()) {
      update.mutate({ id: editing.id, body: { name: editing.name.trim() } });
    }
  };

  const confirmRemove = async (s: System) => {
    const ok = await askConfirm({
      title: 'Borrar sistema',
      message:
        `¿Borrar «${s.name}» del catálogo? Solo se puede si ningún cliente lo tiene asignado. ` +
        'Si la casa dejó de ofrecerlo, retíralo en su lugar.',
      confirmText: 'Sí, borrar',
      tone: 'danger',
    });
    if (ok) remove.mutate(s.id);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Catálogo de sistemas</h1>
        {/*
          Sin esta línea la pantalla se confunde con la de asignar, y alguien da
          de alta aquí un producto que solo quería para un cliente.
        */}
        <p className="text-sm text-slate-500 mt-1">
          Estos son los sistemas que la casa arrienda. Se asignan a cada cliente desde su ficha;
          aquí solo se mantiene la lista.
        </p>
      </div>

      {canManage && (
        <Card>
          <form onSubmit={submitNew} className="p-5 flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[16rem]">
              <label className="label" htmlFor="system-new-name">
                Nuevo sistema
              </label>
              <input
                id="system-new-name"
                className="input"
                value={newName}
                maxLength={120}
                placeholder="Nombre del producto (ej. Sistema de Cobranza)"
                onChange={(e) => setNewName(e.target.value)}
                disabled={busy}
              />
            </div>
            <Button
              type="submit"
              icon={<PlusIcon size={16} />}
              loading={create.isPending}
              disabled={busy || !newName.trim()}
            >
              Dar de alta
            </Button>
          </form>
        </Card>
      )}

      <Card>
        <CardBody>
          {isLoading ? (
            <p className="text-sm text-slate-400">Cargando catálogo…</p>
          ) : isError ? (
            <p role="alert" className="text-sm text-red-600">
              No se pudo cargar el catálogo de sistemas.
            </p>
          ) : systems.length === 0 ? (
            <EmptyState
              icon={<SettingsIcon size={22} />}
              title="El catálogo está vacío"
              description={
                canManage
                  ? 'Da de alta el primer sistema que la casa arrienda para poder asignarlo a los clientes.'
                  : 'Todavía no hay sistemas en el catálogo. Pídele a un administrador que los dé de alta.'
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {systems.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-3 flex-wrap">
                  {editing && editing.id === s.id ? (
                    <form onSubmit={submitRename} className="flex flex-1 gap-2 items-center min-w-[16rem]">
                      <input
                        className="input flex-1"
                        value={editing.name}
                        maxLength={120}
                        aria-label={`Nuevo nombre para ${s.name}`}
                        autoFocus
                        onChange={(e) => setEditing({ id: s.id, name: e.target.value })}
                        disabled={busy}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        icon={<CheckIcon size={14} />}
                        loading={update.isPending}
                        disabled={busy || !editing.name.trim()}
                      >
                        Guardar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        icon={<XIcon size={14} />}
                        onClick={() => setEditing(null)}
                        disabled={busy}
                      >
                        Cancelar
                      </Button>
                    </form>
                  ) : (
                    <>
                      <span
                        className={`flex-1 min-w-[10rem] text-sm font-medium ${
                          s.isActive ? 'text-slate-900' : 'text-slate-400'
                        }`}
                      >
                        {s.name}
                      </span>
                      <Badge tone={s.isActive ? 'success' : 'neutral'}>
                        {s.isActive ? 'Se ofrece' : 'Retirado'}
                      </Badge>
                      {canManage && (
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<PenIcon size={14} />}
                            onClick={() => setEditing({ id: s.id, name: s.name })}
                            disabled={busy}
                          >
                            Renombrar
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => update.mutate({ id: s.id, body: { isActive: !s.isActive } })}
                            disabled={busy}
                            title={
                              s.isActive
                                ? 'Deja de poder asignarse a clientes nuevos. Los que ya lo tienen lo conservan.'
                                : 'Vuelve a poder asignarse a clientes.'
                            }
                          >
                            {s.isActive ? 'Retirar' : 'Reactivar'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<TrashIcon size={14} />}
                            onClick={() => confirmRemove(s)}
                            disabled={busy}
                          >
                            Borrar
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
