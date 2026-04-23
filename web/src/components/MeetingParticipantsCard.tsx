import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { participantsApi, CreateParticipantBody } from '../api/participants.api';
import { projectMembersApi } from '../api/project-members.api';
import { Button } from './ui/Button';
import { Card, CardBody, CardHeader } from './ui/Card';
import { Badge } from './ui/Badge';
import { PlusIcon, UsersIcon, XIcon } from './ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

type Mode = 'internal' | 'guest';

export function MeetingParticipantsCard({
  meetingId,
  projectId,
}: {
  meetingId: number;
  projectId: number;
}) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<Mode>('internal');
  const [form, setForm] = useState({
    userId: '',
    fullName: '',
    documentNumber: '',
    email: '',
    role: '',
  });

  const participantsQ = useQuery({
    queryKey: ['participants', meetingId],
    queryFn: () => participantsApi.list(meetingId),
  });

  const membersQ = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectMembersApi.list(projectId),
    enabled: showForm && mode === 'internal',
  });

  const availableMembers = useMemo(() => {
    if (!membersQ.data) return [];
    const alreadyUserIds = new Set(
      (participantsQ.data ?? [])
        .map((p) => p.userId)
        .filter((x): x is number => !!x),
    );
    return membersQ.data.filter((m) => !alreadyUserIds.has(m.userId));
  }, [membersQ.data, participantsQ.data]);

  const reset = () => {
    setForm({ userId: '', fullName: '', documentNumber: '', email: '', role: '' });
    setMode('internal');
    setShowForm(false);
  };

  const add = useMutation({
    mutationFn: (body: CreateParticipantBody) => participantsApi.create(meetingId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['participants', meetingId] });
      reset();
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message ?? 'No se pudo agregar el participante');
    },
  });

  const toggleAttended = useMutation({
    mutationFn: ({ id, attended }: { id: number; attended: boolean }) =>
      participantsApi.update(id, { attended }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['participants', meetingId] }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => participantsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['participants', meetingId] }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'internal') {
      if (!form.userId) return;
      const member = membersQ.data?.find((m) => m.userId === Number(form.userId));
      if (!member) return;
      add.mutate({
        userId: member.userId,
        fullName: member.fullName,
        email: member.email,
        role: form.role || undefined,
      });
    } else {
      if (!form.fullName.trim()) return;
      add.mutate({
        fullName: form.fullName.trim(),
        documentNumber: form.documentNumber.trim() || undefined,
        email: form.email.trim() || undefined,
        role: form.role.trim() || undefined,
      });
    }
  };

  const participants = participantsQ.data ?? [];

  return (
    <Card>
      <CardHeader
        icon={<UsersIcon size={18} />}
        title="Participantes"
        subtitle="Registra a los asistentes internos y a los invitados externos"
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
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
              {(['internal', 'guest'] as Mode[]).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setMode(m)}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition ${
                    m === mode
                      ? 'bg-kubo-primary text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {m === 'internal' ? 'Interno (miembro)' : 'Invitado externo'}
                </button>
              ))}
            </div>

            {mode === 'internal' ? (
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <div>
                  <label className="label">Miembro del proyecto</label>
                  <select
                    className="input"
                    value={form.userId}
                    onChange={(e) => setForm({ ...form, userId: e.target.value })}
                    required
                  >
                    <option value="">Selecciona…</option>
                    {availableMembers.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.fullName} — {m.email}
                      </option>
                    ))}
                  </select>
                  {membersQ.data && availableMembers.length === 0 && (
                    <p className="text-xs text-slate-400 mt-1">
                      Todos los miembros del proyecto ya están agregados.
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">Cargo (opcional)</label>
                  <input
                    className="input"
                    placeholder="Ej: Developer"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
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
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    required
                    minLength={2}
                    maxLength={180}
                  />
                </div>
                <div>
                  <label className="label">N° documento</label>
                  <input
                    className="input"
                    value={form.documentNumber}
                    onChange={(e) => setForm({ ...form, documentNumber: e.target.value })}
                    maxLength={40}
                  />
                </div>
                <div>
                  <label className="label">Cargo</label>
                  <input
                    className="input"
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
                <div className="md:col-span-2 flex justify-end">
                  <Button type="submit" loading={add.isPending}>
                    Agregar invitado
                  </Button>
                </div>
              </div>
            )}
          </form>
        )}

        {participants.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">
            No hay participantes registrados todavía.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">N° doc</th>
                  <th className="px-3 py-2">Cargo</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Asistió</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {participants.map((p) => {
                  const isInternal = p.userId != null;
                  return (
                    <tr key={p.id} className="text-sm">
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {p.fullName}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={isInternal ? 'info' : 'warning'}>
                          {isInternal ? 'Interno' : 'Invitado'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {p.documentNumber ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{p.role ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{p.email ?? '—'}</td>
                      <td className="px-3 py-2">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!p.attended}
                            disabled={toggleAttended.isPending}
                            onChange={(e) =>
                              toggleAttended.mutate({
                                id: p.id,
                                attended: e.target.checked,
                              })
                            }
                          />
                        </label>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<XIcon size={14} />}
                          onClick={async () => {
                            const ok = await askConfirm({
                              title: 'Quitar participante',
                              message: `¿Quitar a ${p.fullName} de esta reunión?`,
                              confirmText: 'Quitar',
                              tone: 'warning',
                            });
                            if (ok) remove.mutate(p.id);
                          }}
                        >
                          Quitar
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
