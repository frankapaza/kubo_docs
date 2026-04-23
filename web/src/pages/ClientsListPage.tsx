import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientsApi, CreateClientBody } from '../api/clients.api';
import { CLIENT_STATUS_LABELS, CLIENT_STATUSES, type ClientStatus } from '../api/types';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { PlusIcon, UsersIcon, XIcon } from '../components/ui/Icon';
import { toast } from '../ui/Toast';

const STATUS_TONE: Record<ClientStatus, 'neutral' | 'success' | 'info'> = {
  PROSPECT: 'info',
  CLIENT: 'success',
  FORMER_CLIENT: 'neutral',
};

const EMPTY_FORM: CreateClientBody = {
  razonSocial: '',
  ruc: '',
  legalRepName: '',
  legalRepDoc: '',
  phone: '',
  contactEmail: '',
  status: 'PROSPECT',
};

export default function ClientsListPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ClientStatus>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateClientBody>(EMPTY_FORM);

  const { data = [], isLoading } = useQuery({
    queryKey: ['clients', statusFilter, q],
    queryFn: () =>
      clientsApi.list({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        q: q.trim() || undefined,
      }),
  });

  const create = useMutation({
    mutationFn: () => {
      const payload: CreateClientBody = { ...form };
      // Limpiar strings vacíos para que pasen validación opcional
      (Object.keys(payload) as (keyof CreateClientBody)[]).forEach((k) => {
        if (payload[k] === '') delete payload[k];
      });
      return clientsApi.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      setForm(EMPTY_FORM);
      setShowForm(false);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo crear el cliente'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
          <p className="text-sm text-slate-500 mt-1">
            Empresas con las que trabajas. Un cliente puede tener varios proyectos y documentos
            comerciales.
          </p>
        </div>
        <Button icon={<PlusIcon size={16} />} onClick={() => setShowForm((v) => !v)}>
          Nuevo cliente
        </Button>
      </div>

      {/* Form inline */}
      {showForm && (
        <Card>
          <form onSubmit={submit} className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Razón social *</label>
                <input
                  className="input"
                  placeholder="Kubo Soluciones S.A.C."
                  value={form.razonSocial}
                  onChange={(e) => setForm({ ...form, razonSocial: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">RUC</label>
                <input
                  className="input font-mono"
                  placeholder="20605498745"
                  maxLength={11}
                  value={form.ruc ?? ''}
                  onChange={(e) => setForm({ ...form, ruc: e.target.value.replace(/\D/g, '') })}
                />
              </div>
              <div>
                <label className="label">Representante legal</label>
                <input
                  className="input"
                  placeholder="Nombre del representante"
                  value={form.legalRepName ?? ''}
                  onChange={(e) => setForm({ ...form, legalRepName: e.target.value })}
                />
              </div>
              <div>
                <label className="label">DNI del representante</label>
                <input
                  className="input font-mono"
                  placeholder="43713193"
                  value={form.legalRepDoc ?? ''}
                  onChange={(e) => setForm({ ...form, legalRepDoc: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Teléfono</label>
                <input
                  className="input"
                  placeholder="986095857"
                  value={form.phone ?? ''}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Email de contacto</label>
                <input
                  type="email"
                  className="input"
                  placeholder="contacto@cliente.com"
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
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" loading={create.isPending}>
                Guardar cliente
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowForm(false);
                  setForm(EMPTY_FORM);
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap items-center">
        <input
          className="input flex-1 min-w-[200px] max-w-md"
          placeholder="Buscar por razón social…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
          {(['ALL', ...CLIENT_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md transition ${
                statusFilter === s
                  ? 'bg-kubo-primary-light text-kubo-primary-dark'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {s === 'ALL' ? 'Todos' : CLIENT_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <Card>
          <CardBody>
            <div className="py-10 text-center text-sm text-slate-400">Cargando clientes…</div>
          </CardBody>
        </Card>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UsersIcon size={22} />}
            title={q || statusFilter !== 'ALL' ? 'Sin resultados' : 'Aún no tienes clientes'}
            description={
              q || statusFilter !== 'ALL'
                ? 'Prueba con otros filtros o limpia la búsqueda.'
                : 'Agrega tu primer cliente para empezar a registrar reuniones y documentos.'
            }
            action={
              !q && statusFilter === 'ALL' ? (
                <Button
                  variant="primary"
                  icon={<PlusIcon size={16} />}
                  onClick={() => setShowForm(true)}
                >
                  Nuevo cliente
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  icon={<XIcon size={16} />}
                  onClick={() => {
                    setQ('');
                    setStatusFilter('ALL');
                  }}
                >
                  Limpiar filtros
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.map((c) => (
            <Link
              key={c.id}
              to={`/clients/${c.id}`}
              className="group bg-white border border-slate-200 rounded-xl shadow-card p-5 hover:shadow-pop hover:border-indigo-200 transition block"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-semibold text-slate-900 line-clamp-2 group-hover:text-kubo-primary-dark transition flex-1">
                  {c.razonSocial}
                </h3>
                <Badge tone={STATUS_TONE[c.status]}>{CLIENT_STATUS_LABELS[c.status]}</Badge>
              </div>
              <div className="space-y-1 text-xs text-slate-500">
                {c.ruc && (
                  <p>
                    <span className="font-medium">RUC:</span>{' '}
                    <span className="font-mono">{c.ruc}</span>
                  </p>
                )}
                {c.legalRepName && (
                  <p className="truncate">
                    <span className="font-medium">Rep.:</span> {c.legalRepName}
                  </p>
                )}
                {c.contactEmail && <p className="truncate">{c.contactEmail}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
