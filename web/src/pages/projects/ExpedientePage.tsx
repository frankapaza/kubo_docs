import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  DELIVERABLE_TYPES,
  Deliverable,
  DeliverableStatus,
  Expediente,
  WORK_TYPE_OPTIONS,
  WorkType,
  expedienteApi,
} from '../../api/expediente.api';
import { useAuth } from '../../auth/AuthContext';
import { canLeadProject } from '../../auth/permissions';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DownloadIcon, FileTextIcon, PlusIcon, TrashIcon, UploadIcon } from '../../components/ui/Icon';
import { askConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../ui/Toast';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple';

const STATUS_TONE: Record<DeliverableStatus, Tone> = {
  PENDIENTE: 'neutral',
  BORRADOR: 'purple',
  EN_REVISION: 'warning',
  APROBADO: 'info',
  FIRMADO: 'success',
  NO_APLICA: 'neutral',
};

const HISTORY_COLOR: Record<string, string> = {
  E: '#5b2fb0',
  R: '#8a4b00',
  A: '#012660',
  F: '#1e7a3c',
  N: '#4b5563',
  P: '#4b5563',
};

function errorText(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : m ?? fallback;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPT = '.pdf,.docx,.xlsx,.pptx,.mpp,.png,.jpg,.jpeg,.webp';

export default function ExpedientePage() {
  const projectId = Number(useParams().projectId);
  const { user } = useAuth();
  const lead = canLeadProject(user);
  const qc = useQueryClient();
  const key = ['expediente', projectId];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => expedienteApi.get(projectId) });
  const [picked, setPicked] = useState<number | null>(null);
  const [zipping, setZipping] = useState(false);

  const setWorkType = useMutation({
    mutationFn: (w: WorkType) => expedienteApi.setWorkType(projectId, w),
    onSuccess: (exp) => {
      qc.setQueryData(key, exp);
      toast.success(`Expediente de ${exp.project.workTypeLabel?.toLowerCase()} listo.`);
    },
    onError: (e) => toast.error(errorText(e, 'No se pudo guardar el tipo de trabajo.')),
  });

  const selected = data?.deliverables.find((d) => d.id === picked) ?? null;

  useEffect(() => {
    if (data && picked == null) {
      const first = data.deliverables.find((d) => d.status !== 'NO_APLICA');
      if (first) setPicked(first.id);
    }
  }, [data, picked]);

  if (isLoading) return <div className="p-6 text-slate-500">Cargando expediente…</div>;
  if (error || !data) {
    return <div className="p-6 text-red-600">{errorText(error, 'No se pudo cargar el expediente.')}</div>;
  }

  const { project, summary } = data;

  const downloadZip = async () => {
    setZipping(true);
    try {
      await expedienteApi.downloadZip(projectId, `KUBO-${project.code}-Expediente.zip`);
    } catch (e) {
      toast.error('No se pudo descargar el expediente. Si pesa mucho, descarga los documentos por separado.');
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">
            <Link to="/projects" className="hover:underline">
              Proyectos
            </Link>{' '}
            / Expediente
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {project.name} · <span className="text-slate-500">{project.code}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!project.workTypeLabel ? (
              <Badge>Sin tipo de trabajo</Badge>
            ) : (
              !lead && <Badge tone="primary">{project.workTypeLabel}</Badge>
            )}
            {project.workType && lead && (
              <select
                aria-label="Cambiar el tipo de trabajo"
                className="text-xs border border-slate-300 rounded-md px-2 py-1 bg-white"
                value={project.workType}
                disabled={setWorkType.isPending}
                onChange={async (e) => {
                  const w = e.target.value as WorkType;
                  const ok = await askConfirm({
                    title: 'Cambiar el tipo de trabajo',
                    message:
                      'Se recalcula qué entregables son obligatorios. Los pendientes que dejen de aplicar se marcan «no aplica»; lo ya trabajado no cambia.',
                    confirmText: 'Cambiar',
                  });
                  if (ok) setWorkType.mutate(w);
                }}
              >
                {WORK_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        {project.workType && (
          <Button variant="secondary" onClick={downloadZip} loading={zipping} icon={<DownloadIcon size={16} />}>
            Descargar expediente (.zip)
          </Button>
        )}
      </div>

      {!project.workType ? (
        <Card>
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-900">¿Qué tipo de trabajo es este proyecto?</h2>
            <p className="text-sm text-slate-600 mt-1">
              Según el tipo se arma el expediente con los entregables que pide la metodología: obligatorios, opcionales y los que
              no aplican.
            </p>
            {lead ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {WORK_TYPE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    disabled={setWorkType.isPending}
                    onClick={() => setWorkType.mutate(o.value)}
                    className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-kubo-primary hover:bg-slate-50 disabled:opacity-60"
                  >
                    <div className="font-medium text-slate-900">{o.label}</div>
                    <div className="text-xs text-slate-500 mt-1">{o.hint}</div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">Pídele al jefe del proyecto que elija el tipo de trabajo.</p>
            )}
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Tile label="Entregables" value={summary.total} hint={`${summary.required} obligatorios`} />
            <Tile label="Aprobados o firmados" value={summary.approved} hint={pct(summary.approved, summary.total)} />
            <Tile label="En borrador o revisión" value={summary.inProgress} />
            <Tile label="Pendientes" value={summary.pending} />
            <Tile label="No aplican" value={summary.notApplicable} />
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] items-start">
            <div className="flex flex-col gap-4">
              {summary.phases
                .filter((ph) => data.deliverables.some((d) => d.phase === ph.phase))
                .map((ph) => (
                  <Card key={ph.phase}>
                    <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3 border-b border-slate-100">
                      <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{ph.label}</div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <div className="w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden>
                          <div
                            className="h-full bg-emerald-500"
                            style={{ width: ph.total ? `${(100 * ph.done) / ph.total}%` : 0 }}
                          />
                        </div>
                        {ph.done} de {ph.total} aprobados
                      </div>
                    </div>
                    <ul>
                      {data.deliverables
                        .filter((d) => d.phase === ph.phase)
                        .map((d) => (
                          <li key={d.id}>
                            <button
                              type="button"
                              onClick={() => setPicked(d.id)}
                              className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 ${
                                d.id === picked ? 'bg-[#eef3fb]' : ''
                              } ${d.status === 'NO_APLICA' ? 'opacity-60' : ''}`}
                            >
                              <FileTextIcon size={18} className="text-slate-400 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-slate-900 truncate">
                                  {d.name}
                                  {d.requirement === 'O' && d.status !== 'NO_APLICA' && (
                                    <span className="ml-1.5 text-[10px] font-semibold text-red-600 align-middle">OBLIGATORIO</span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-500 truncate">{d.nomenclature}</div>
                              </div>
                              <Badge tone={STATUS_TONE[d.status]}>{d.statusLabel}</Badge>
                              <span className="w-10 text-right text-xs text-slate-500 tabular-nums">{d.version ? `V${d.version}` : '—'}</span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  </Card>
                ))}
              <AddDeliverable projectId={projectId} onAdded={(d) => setPicked(d.id)} />
            </div>

            {selected && <DeliverablePanel key={selected.id} projectId={projectId} d={selected} lead={lead} onRemoved={() => setPicked(null)} />}
          </div>
        </>
      )}
    </div>
  );
}

function pct(a: number, b: number): string {
  return b ? `${Math.round((100 * a) / b)} % del expediente` : '';
}

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card>
      <div className="p-4">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-2xl font-semibold text-slate-900 tabular-nums">{value}</div>
        {hint && <div className="text-xs text-slate-400">{hint}</div>}
      </div>
    </Card>
  );
}

function AddDeliverable({ projectId, onAdded }: { projectId: number; onAdded: (d: Deliverable) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(DELIVERABLE_TYPES[0].type);
  const [title, setTitle] = useState('');
  const add = useMutation({
    mutationFn: () => expedienteApi.add(projectId, type, title.trim()),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['expediente', projectId] });
      setOpen(false);
      setTitle('');
      onAdded(d);
    },
    onError: (e) => toast.error(errorText(e, 'No se pudo agregar el entregable.')),
  });
  if (!open) {
    return (
      <div>
        <Button variant="secondary" size="sm" icon={<PlusIcon size={14} />} onClick={() => setOpen(true)}>
          Agregar entregable
        </Button>
      </div>
    );
  }
  return (
    <Card>
      <div className="p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600 flex flex-col gap-1">
          Tipo
          <select className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white" value={type} onChange={(e) => setType(e.target.value)}>
            {DELIVERABLE_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600 flex flex-col gap-1 flex-1 min-w-[200px]">
          Título (opcional)
          <input
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            maxLength={180}
            placeholder="p. ej. Acta de reunión · avance de marzo"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <Button size="sm" onClick={() => add.mutate()} loading={add.isPending}>
          Agregar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}

function DeliverablePanel({
  projectId,
  d,
  lead,
  onRemoved,
}: {
  projectId: number;
  d: Deliverable;
  lead: boolean;
  onRemoved: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const signRef = useRef<HTMLInputElement>(null);
  const historyKey = ['expediente', projectId, 'history', d.id];
  const history = useQuery({ queryKey: historyKey, queryFn: () => expedienteApi.history(projectId, d.id) });

  const done = (msg: string) => (updated: Deliverable | void) => {
    qc.setQueryData<Expediente>(['expediente', projectId], (old) =>
      old && updated ? { ...old, deliverables: old.deliverables.map((x) => (x.id === updated.id ? updated : x)) } : old,
    );
    qc.invalidateQueries({ queryKey: ['expediente', projectId] });
    setNote('');
    toast.success(msg);
  };

  const run = useMutation({
    mutationFn: async (fn: () => Promise<Deliverable | void>) => fn(),
    onError: (e) => toast.error(errorText(e, 'No se pudo completar la acción.')),
  });
  const act = (fn: () => Promise<Deliverable | void>, msg: string) => run.mutate(fn, { onSuccess: done(msg) });

  const requireNote = (what: string): string | null => {
    const n = note.trim();
    if (!n) {
      toast.warning(`Escribe en la nota ${what}.`);
      return null;
    }
    return n;
  };

  const s = d.status;
  const busy = run.isPending;

  return (
    <Card>
      <div className="p-4 flex flex-col gap-4 lg:sticky lg:top-4">
        <div>
          <div className="text-[11px] font-semibold tracking-wide text-slate-400">ENTREGABLE · {d.phaseLabel.toUpperCase()}</div>
          <div className="text-lg font-semibold text-slate-900">{d.name}</div>
          <div className="text-xs text-slate-500 break-all">{d.nomenclature}</div>
          <div className="mt-2 flex flex-wrap gap-2 items-center">
            <Badge tone={STATUS_TONE[s]}>{d.statusLabel}</Badge>
            <Badge>{d.requirement === 'O' ? 'Obligatorio' : d.requirement === 'OP' ? 'Opcional' : 'No aplica al tipo de trabajo'}</Badge>
          </div>
          {d.naReason && s === 'NO_APLICA' && <p className="mt-2 text-sm text-slate-600">Motivo: {d.naReason}</p>}
        </div>

        {d.lastFile && (
          <button
            type="button"
            className="flex items-center gap-2 text-sm text-kubo-primary hover:underline text-left"
            onClick={() =>
              expedienteApi
                .downloadVersion(projectId, d.id, d.lastFile!.versionId, d.lastFile!.filename, d.lastFile!.mimeType)
                .catch(() => toast.error('No se pudo descargar el archivo.'))
            }
          >
            <DownloadIcon size={16} /> {d.lastFile.filename} <span className="text-slate-400">({formatBytes(d.lastFile.sizeBytes)})</span>
          </button>
        )}

        {s !== 'NO_APLICA' && (
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Nota {s === 'EN_REVISION' && lead ? '(obligatoria para observar)' : '(opcional)'}
            <textarea
              rows={2}
              maxLength={1000}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
              placeholder={s === 'EN_REVISION' ? 'Qué hay que corregir, o un comentario de la aprobación' : 'Qué cambió en esta versión'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) act(() => expedienteApi.upload(projectId, d.id, f, note.trim()), 'Versión subida.');
          }}
        />
        <input
          ref={signRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) act(() => expedienteApi.sign(projectId, d.id, f, note.trim()), 'Marcado como firmado.');
          }}
        />

        <div className="flex flex-wrap gap-2">
          {s !== 'NO_APLICA' && (
            <Button size="sm" icon={<UploadIcon size={14} />} disabled={busy} onClick={() => fileRef.current?.click()}>
              {s === 'PENDIENTE' ? 'Subir primera versión' : 'Subir nueva versión'}
            </Button>
          )}
          {s === 'BORRADOR' && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => expedienteApi.submit(projectId, d.id, note.trim()), 'Enviado a revisión.')}>
              Enviar a revisión
            </Button>
          )}
          {lead && (s === 'BORRADOR' || s === 'EN_REVISION') && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => expedienteApi.approve(projectId, d.id, note.trim()), 'Aprobado.')}>
              Aprobar
            </Button>
          )}
          {lead && s === 'EN_REVISION' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const n = requireNote('qué hay que corregir');
                if (n) act(() => expedienteApi.observe(projectId, d.id, n), 'Observado: vuelve a borrador.');
              }}
            >
              Observar
            </Button>
          )}
          {lead && s === 'APROBADO' && (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => signRef.current?.click()}>
                Subir documento firmado
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => expedienteApi.sign(projectId, d.id, null, note.trim()), 'Marcado como firmado.')}>
                Marcar firmado sin archivo
              </Button>
            </>
          )}
          {lead && s === 'PENDIENTE' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                const n = requireNote('por qué no aplica');
                if (n) act(() => expedienteApi.notApplicable(projectId, d.id, n), 'Marcado como «no aplica».');
              }}
            >
              No aplica…
            </Button>
          )}
          {lead && s === 'NO_APLICA' && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => expedienteApi.reopen(projectId, d.id), 'Reabierto.')}>
              Reabrir
            </Button>
          )}
          {!d.fromCatalog && s === 'PENDIENTE' && (history.data?.length ?? 0) === 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon={<TrashIcon size={14} />}
              disabled={busy}
              onClick={async () => {
                const ok = await askConfirm({ message: `¿Quitar «${d.name}» del expediente?`, tone: 'danger', confirmText: 'Quitar' });
                if (!ok) return;
                run.mutate(() => expedienteApi.remove(projectId, d.id), {
                  onSuccess: () => {
                    qc.invalidateQueries({ queryKey: ['expediente', projectId] });
                    onRemoved();
                  },
                });
              }}
            >
              Quitar
            </Button>
          )}
        </div>

        <div>
          <div className="text-[11px] font-semibold tracking-wide text-slate-400 mb-2">HISTORIAL DE REVISIONES</div>
          {history.isLoading ? (
            <div className="text-sm text-slate-400">Cargando…</div>
          ) : !history.data?.length ? (
            <div className="text-sm text-slate-400">Todavía no hay versiones.</div>
          ) : (
            <ol className="flex flex-col gap-2">
              {[...history.data].reverse().map((h) => (
                <li key={h.id} className="flex gap-3 text-sm">
                  <span className="w-10 shrink-0 text-xs text-slate-500 tabular-nums pt-0.5">{h.version ? `V${h.version}` : ''}</span>
                  <div className="min-w-0 flex-1">
                    <div>
                      <span className="font-medium" style={{ color: HISTORY_COLOR[h.action] }}>
                        {h.actionLabel}
                      </span>
                      <span className="text-slate-500">
                        {' '}
                        · {h.actorName ?? 'Sistema'} · {new Date(h.createdAt).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                    {h.note && <div className="text-slate-700 whitespace-pre-wrap">{h.note}</div>}
                    {h.file && (
                      <button
                        type="button"
                        className="text-xs text-kubo-primary hover:underline break-all text-left"
                        onClick={() =>
                          expedienteApi
                            .downloadVersion(projectId, d.id, h.id, h.file!.filename, h.file!.mimeType)
                            .catch(() => toast.error('No se pudo descargar el archivo.'))
                        }
                      >
                        {h.file.filename}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Card>
  );
}

