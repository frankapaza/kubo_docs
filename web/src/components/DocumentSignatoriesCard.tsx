import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { documentSignatoriesApi } from '../api/documents.api';
import { usersApi } from '../api/users.api';
import {
  CONFORMITY_STATUSES,
  CONFORMITY_STATUS_LABELS,
  ConformityStatus,
} from '../api/types';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Card, CardBody, CardHeader } from './ui/Card';
import { PlusIcon, UsersIcon, XIcon } from './ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

type KindMode = 'INTERNAL' | 'EXTERNAL';
type BadgeTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'primary' | 'purple';

const conformityTones: Record<ConformityStatus, BadgeTone> = {
  PENDING: 'neutral',
  SIGNED: 'success',
  REFUSED: 'danger',
  ABSENT_EARLY: 'warning',
  ABSENT: 'neutral',
};

const conformityEmoji: Record<ConformityStatus, string> = {
  PENDING: '⏳',
  SIGNED: '✅',
  REFUSED: '❌',
  ABSENT_EARLY: '🚪',
  ABSENT: '—',
};

export function DocumentSignatoriesCard({ documentId }: { documentId: number }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<KindMode>('INTERNAL');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [form, setForm] = useState({
    fullName: '',
    documentNumber: '',
    email: '',
    role: '',
  });

  const listQ = useQuery({
    queryKey: ['document-signatories', documentId],
    queryFn: () => documentSignatoriesApi.list(documentId),
  });

  const usersQ = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list(),
    staleTime: 60_000,
    enabled: showForm && mode === 'INTERNAL',
  });

  const signatories = listQ.data ?? [];

  const alreadyUserIds = useMemo(
    () => new Set(signatories.map((s) => s.userId).filter((id): id is number => id != null)),
    [signatories],
  );

  const availableUsers = useMemo(
    () => (usersQ.data ?? []).filter((u) => !alreadyUserIds.has(u.id)),
    [usersQ.data, alreadyUserIds],
  );

  const reset = () => {
    setSelectedUserId('');
    setForm({ fullName: '', documentNumber: '', email: '', role: '' });
    setShowForm(false);
  };

  const add = useMutation({
    mutationFn: (body: Parameters<typeof documentSignatoriesApi.create>[1]) =>
      documentSignatoriesApi.create(documentId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-signatories', documentId] });
      reset();
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo agregar'),
  });

  const setConformity = useMutation({
    mutationFn: ({ id, conformityStatus }: { id: number; conformityStatus: ConformityStatus }) =>
      documentSignatoriesApi.update(id, { conformityStatus }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document-signatories', documentId] }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => documentSignatoriesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document-signatories', documentId] }),
  });

  const requestSig = useMutation({
    mutationFn: (id: number) => documentSignatoriesApi.requestSignature(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-signatories', documentId] });
      toast.success('Solicitud de firma enviada por email.');
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo enviar la solicitud'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'INTERNAL') {
      const user = usersQ.data?.find((u) => u.id === Number(selectedUserId));
      if (!user) return;
      add.mutate({
        kind: 'INTERNAL',
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        role: form.role.trim() || undefined,
      });
    } else {
      if (!form.fullName.trim()) return;
      add.mutate({
        kind: 'EXTERNAL',
        fullName: form.fullName.trim(),
        documentNumber: form.documentNumber.trim() || undefined,
        email: form.email.trim() || undefined,
        role: form.role.trim() || undefined,
      });
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<UsersIcon size={18} />}
        title="Firmantes y conformidad"
        subtitle="Registra quiénes participaron y deja evidencia de su conformidad"
        action={
          <Button
            size="sm"
            variant="primary"
            icon={<PlusIcon size={14} />}
            onClick={() => setShowForm((v) => !v)}
          >
            Agregar
          </Button>
        }
      />
      <CardBody>
        {showForm && (
          <form
            onSubmit={submit}
            className="mb-4 p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3"
          >
            {/* Toggle interno / externo */}
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
              {(['INTERNAL', 'EXTERNAL'] as KindMode[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMode(k)}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition ${
                    mode === k
                      ? 'bg-kubo-primary text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {k === 'INTERNAL' ? 'Miembro interno' : 'Cliente externo'}
                </button>
              ))}
            </div>

            {mode === 'INTERNAL' ? (
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <div>
                  <label className="label">Usuario del sistema *</label>
                  <select
                    className="input"
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    required
                  >
                    <option value="">Selecciona un usuario…</option>
                    {availableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName} — {u.email}
                      </option>
                    ))}
                  </select>
                  {usersQ.data && availableUsers.length === 0 && (
                    <p className="text-xs text-slate-400 mt-1">
                      Todos los usuarios ya están agregados.
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">Cargo (opcional)</label>
                  <input
                    className="input"
                    placeholder="Ej: Project Manager"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                    maxLength={80}
                  />
                </div>
                <Button type="submit" loading={add.isPending}>
                  Agregar
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Nombres completos *</label>
                  <input
                    className="input"
                    placeholder="Ej: Juan Pérez"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    required
                    maxLength={180}
                  />
                </div>
                <div>
                  <label className="label">N° documento</label>
                  <input
                    className="input font-mono"
                    placeholder="DNI / RUC"
                    value={form.documentNumber}
                    onChange={(e) => setForm({ ...form, documentNumber: e.target.value })}
                    maxLength={40}
                  />
                </div>
                <div>
                  <label className="label">Cargo / Rol en el cliente</label>
                  <input
                    className="input"
                    placeholder="Ej: Gerente de TI"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                    maxLength={80}
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    className="input"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    maxLength={180}
                  />
                </div>
              </div>
            )}

            {mode === 'EXTERNAL' && (
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="ghost" onClick={reset}>
                  Cancelar
                </Button>
                <Button type="submit" loading={add.isPending}>
                  Agregar cliente
                </Button>
              </div>
            )}
            {mode === 'INTERNAL' && (
              <div>
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  Cancelar
                </Button>
              </div>
            )}
          </form>
        )}

        {signatories.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">
            No hay firmantes registrados todavía.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Cargo</th>
                  <th className="px-3 py-2">N° doc</th>
                  <th className="px-3 py-2">Conformidad</th>
                  <th className="px-3 py-2">Firma electrónica</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {signatories.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition">
                    <td className="px-3 py-2.5 font-medium text-slate-900">
                      <p>{s.fullName}</p>
                      {s.email && (
                        <p className="text-xs text-slate-400 font-normal">{s.email}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={s.kind === 'INTERNAL' ? 'info' : 'warning'}>
                        {s.kind === 'INTERNAL' ? 'Interno' : 'Externo'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{s.role ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 font-mono text-xs">
                      {s.documentNumber ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-kubo-primary/30 cursor-pointer"
                        value={s.conformityStatus}
                        disabled={setConformity.isPending}
                        onChange={(e) =>
                          setConformity.mutate({
                            id: s.id,
                            conformityStatus: e.target.value as ConformityStatus,
                          })
                        }
                      >
                        {CONFORMITY_STATUSES.map((cs) => (
                          <option key={cs} value={cs}>
                            {conformityEmoji[cs]} {CONFORMITY_STATUS_LABELS[cs]}
                          </option>
                        ))}
                      </select>
                      <span className="ml-2">
                        <Badge tone={conformityTones[s.conformityStatus]} dot>
                          {CONFORMITY_STATUS_LABELS[s.conformityStatus]}
                        </Badge>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {s.kind === 'EXTERNAL' && s.email && s.conformityStatus !== 'SIGNED' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={requestSig.isPending && requestSig.variables === s.id}
                          onClick={() => requestSig.mutate(s.id)}
                        >
                          {s.signatureToken ? 'Reenviar' : 'Solicitar firma'}
                        </Button>
                      ) : s.conformityStatus === 'SIGNED' && s.signedAt ? (
                        <span className="text-xs text-slate-400">
                          {new Date(s.signedAt).toLocaleDateString('es-PE')}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<XIcon size={14} />}
                        onClick={async () => {
                          const ok = await askConfirm({
                            title: 'Quitar firmante',
                            message: `¿Quitar a ${s.fullName} de este documento?`,
                            confirmText: 'Quitar',
                            tone: 'warning',
                          });
                          if (ok) remove.mutate(s.id);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Resumen de conformidad */}
        {signatories.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap gap-3">
            {CONFORMITY_STATUSES.filter((cs) => cs !== 'PENDING').map((cs) => {
              const count = signatories.filter((s) => s.conformityStatus === cs).length;
              if (count === 0) return null;
              return (
                <span key={cs} className="text-xs text-slate-600">
                  {conformityEmoji[cs]} <strong>{count}</strong> {CONFORMITY_STATUS_LABELS[cs]}
                </span>
              );
            })}
            {signatories.filter((s) => s.conformityStatus === 'PENDING').length > 0 && (
              <span className="text-xs text-slate-400">
                ⏳{' '}
                <strong>
                  {signatories.filter((s) => s.conformityStatus === 'PENDING').length}
                </strong>{' '}
                pendiente(s)
              </span>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
