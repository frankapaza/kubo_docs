import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientRequestsApi } from '../api/client-requests.api';
import { clientsApi } from '../api/clients.api';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import {
  RequestPriorityBadge,
  RequestStatusBadge,
  RequestTypeBadge,
  ServiceCategoryBadge,
} from '../components/ui/Badge';
import {
  CLIENT_REQUEST_SOURCE_LABELS,
  CLIENT_REQUEST_STATUSES,
  CLIENT_REQUEST_STATUS_LABELS,
  ClientRequestSource,
  ClientRequestStatus,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_LABELS,
  ServiceCategory,
} from '../api/types';
import {
  InboxIcon,
  InfoIcon,
  MicIcon,
  PlusIcon,
  RefreshIcon,
  UploadIcon,
} from '../components/ui/Icon';
import { toast } from '../ui/Toast';

type CaptureMode = 'text' | 'audio' | 'live';

export default function RequestsListPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<ClientRequestStatus | ''>('');
  const [filterClient, setFilterClient] = useState<number | ''>('');
  const [filterCategory, setFilterCategory] = useState<ServiceCategory | ''>('');
  const [search, setSearch] = useState('');

  const { data: clients } = useQuery({
    queryKey: ['clients-simple'],
    queryFn: () => clientsApi.list({ status: 'CLIENT' }),
    staleTime: 60_000,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['client-requests', { filterStatus, filterClient, filterCategory, search }],
    queryFn: () =>
      clientRequestsApi.list({
        status: filterStatus || undefined,
        clientId: filterClient === '' ? undefined : Number(filterClient),
        serviceCategory: filterCategory || undefined,
        q: search || undefined,
      }),
  });

  const requests = data ?? [];

  const clientById = useMemo(() => {
    const m = new Map<number, string>();
    clients?.forEach((c) => m.set(c.id, c.razonSocial));
    return m;
  }, [clients]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <InboxIcon size={22} className="text-kubo-primary" />
            Solicitudes de clientes
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Captura rápida de atenciones, ajustes y mejoras. Estructuralas con IA y envíalas a Jira.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<PlusIcon size={16} />}
          onClick={() => setShowForm((v) => !v)}
        >
          Nueva solicitud
        </Button>
      </div>

      {showForm && (
        <NewRequestCard
          onCreated={() => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ['client-requests'] });
          }}
        />
      )}

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <input
            className="input flex-1 min-w-[180px]"
            placeholder="Buscar en texto o título…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input w-44"
            value={filterStatus}
            onChange={(e) => setFilterStatus((e.target.value as ClientRequestStatus) || '')}
          >
            <option value="">Todos los estados</option>
            {CLIENT_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CLIENT_REQUEST_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            className="input w-48"
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Todos los clientes</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.razonSocial}
                {c.jiraCode ? ` · ${c.jiraCode}` : ''}
              </option>
            ))}
          </select>
          <select
            className="input w-48"
            value={filterCategory}
            onChange={(e) => setFilterCategory((e.target.value as ServiceCategory) || '')}
          >
            <option value="">Todas las categorías</option>
            {SERVICE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {SERVICE_CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </CardBody>
      </Card>

      {isLoading ? (
        <Card>
          <div className="p-12 text-center text-sm text-slate-400">Cargando solicitudes…</div>
        </Card>
      ) : requests.length === 0 ? (
        <Card>
          <EmptyState
            icon={<InboxIcon size={22} />}
            title="Bandeja vacía"
            description="Anota la primera solicitud de un cliente. Puede ser texto, audio o dictado."
            action={
              <Button
                variant="primary"
                icon={<PlusIcon size={16} />}
                onClick={() => setShowForm(true)}
              >
                Nueva solicitud
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => {
            const clientName = r.clientId ? clientById.get(r.clientId) ?? null : null;
            return (
              <Link
                key={r.id}
                to={`/requests/${r.id}`}
                className="block bg-white border border-slate-200 rounded-xl shadow-card p-4 hover:shadow-pop hover:border-indigo-200 transition"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <ServiceCategoryBadge category={r.serviceCategory} />
                      <RequestStatusBadge status={r.status} />
                      <RequestTypeBadge type={r.requestType} />
                      <RequestPriorityBadge priority={r.priority} />
                      <span className="text-[11px] text-slate-400">
                        · {CLIENT_REQUEST_SOURCE_LABELS[r.source]}
                      </span>
                    </div>
                    <p className="font-semibold text-slate-900 line-clamp-1">
                      {r.title ?? truncate(r.rawText, 140)}
                    </p>
                    {r.title && (
                      <p className="text-xs text-slate-500 line-clamp-2 mt-1">
                        {truncate(r.rawText, 220)}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-2 flex-wrap">
                      {clientName && <span>👤 {clientName}</span>}
                      {r.moduleName && <span>📂 {r.moduleName}</span>}
                      {r.screenName && <span>🖥 {r.screenName}</span>}
                      <span>🕒 {new Date(r.createdAt).toLocaleString('es')}</span>
                      {r.jiraIssueKey && (
                        <span className="text-emerald-600 font-medium">✓ {r.jiraIssueKey}</span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function truncate(s: string, max: number) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ---------------------------------------------------------------------------
// Formulario de captura (texto / audio / grabación en vivo)
// ---------------------------------------------------------------------------

function NewRequestCard({ onCreated }: { onCreated: () => void }) {
  const [mode, setMode] = useState<CaptureMode>('text');
  const [rawText, setRawText] = useState('');
  const [source, setSource] = useState<ClientRequestSource>('NOTE');
  const [clientId, setClientId] = useState<number | ''>('');
  const [projectId, setProjectId] = useState<number | ''>('');
  const [audioFilename, setAudioFilename] = useState<string | null>(null);
  const [serviceCategory, setServiceCategory] = useState<ServiceCategory | ''>('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');

  const { data: clients } = useQuery({
    queryKey: ['clients-simple'],
    queryFn: () => clientsApi.list({ status: 'CLIENT' }),
  });

  const create = useMutation({
    mutationFn: (body: Parameters<typeof clientRequestsApi.create>[0]) =>
      clientRequestsApi.create(body),
    onSuccess: () => {
      toast.success('Solicitud guardada en la bandeja.');
      onCreated();
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo guardar la solicitud'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (rawText.trim().length < 3) {
      toast.error('El texto es demasiado corto.');
      return;
    }
    create.mutate({
      rawText,
      source,
      clientId: clientId === '' ? undefined : Number(clientId),
      projectId: projectId === '' ? undefined : Number(projectId),
      rawAudioFilename: audioFilename ?? undefined,
      serviceCategory: serviceCategory || undefined,
      scheduledAt: scheduledAt || undefined,
      durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
    });
  };

  return (
    <Card className="border-2 border-indigo-100">
      <CardHeader
        icon={<PlusIcon size={18} />}
        title="Nueva solicitud"
        subtitle="Captura en crudo. La IA la estructura después."
      />
      <CardBody>
        <div className="flex gap-2 mb-4 border-b border-slate-100">
          {(['text', 'audio', 'live'] as CaptureMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-2 text-sm font-medium transition border-b-2 -mb-px ${
                mode === m
                  ? 'text-kubo-primary-dark border-kubo-primary'
                  : 'text-slate-500 border-transparent hover:text-slate-800'
              }`}
            >
              {m === 'text' && 'Texto'}
              {m === 'audio' && 'Archivo de audio'}
              {m === 'live' && 'Grabar ahora'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'audio' && (
            <AudioFileCapture
              onTranscribed={(text, filename) => {
                setRawText(text);
                setAudioFilename(filename);
                setSource('WHATSAPP_AUDIO');
              }}
            />
          )}
          {mode === 'live' && (
            <LiveMicCapture
              onTranscribed={(text) => {
                setRawText(text);
                setSource('VOICE_LIVE');
              }}
            />
          )}

          <div>
            <label className="label">
              Texto de la solicitud
              {mode !== 'text' && (
                <span className="text-[11px] font-normal text-slate-400 ml-2">
                  (editable después de transcribir)
                </span>
              )}
            </label>
            <textarea
              className="input min-h-[140px] resize-y font-mono text-sm"
              placeholder={
                mode === 'text'
                  ? 'Pega el WhatsApp o escribe la solicitud tal cual te la contaron…'
                  : 'La transcripción aparecerá aquí. Puedes editarla antes de guardar.'
              }
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Categoría *</label>
              <select
                className="input"
                value={serviceCategory}
                onChange={(e) => setServiceCategory((e.target.value as ServiceCategory) || '')}
                required
              >
                <option value="">(seleccionar categoría)</option>
                {SERVICE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {SERVICE_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Fuente</label>
              <select
                className="input"
                value={source}
                onChange={(e) => setSource(e.target.value as ClientRequestSource)}
              >
                <option value="NOTE">Nota rápida</option>
                <option value="WHATSAPP_TEXT">WhatsApp (texto)</option>
                <option value="WHATSAPP_AUDIO">WhatsApp (audio)</option>
                <option value="VOICE_LIVE">Dictado en vivo</option>
                <option value="MEETING">Reunión</option>
                <option value="OTHER">Otra</option>
              </select>
            </div>
          </div>

          {(serviceCategory === 'CAPACITACION' || serviceCategory === 'VISITA_SITIO') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div>
                <label className="label">Fecha y hora pactada</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Duración estimada (minutos)</label>
                <input
                  type="number"
                  className="input"
                  placeholder="Ej: 90"
                  min={1}
                  max={9999}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Cliente</label>
              <select
                className="input"
                value={clientId}
                onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">(sin cliente)</option>
                {clients?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.razonSocial}
                  </option>
                ))}
              </select>
            </div>
            <ProjectSelect
              clientId={clientId === '' ? null : Number(clientId)}
              value={projectId}
              onChange={setProjectId}
            />
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600 flex items-start gap-2">
            <InfoIcon size={14} className="text-slate-400 mt-0.5 shrink-0" />
            <span>
              La solicitud se guarda en la bandeja con el texto tal cual. En el detalle podrás
              estructurarla con IA (título, módulo, criterios de aceptación) y recién ahí enviarla a
              Jira.
            </span>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={create.isPending}>
              Guardar en bandeja
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function ProjectSelect({
  clientId,
  value,
  onChange,
}: {
  clientId: number | null;
  value: number | '';
  onChange: (v: number | '') => void;
}) {
  const { data: projects } = useQuery({
    queryKey: ['projects-simple'],
    queryFn: async () => {
      const { projectsApi } = await import('../api/projects.api');
      return projectsApi.list({ status: 'ACTIVE' }).then((r) => r.data);
    },
    staleTime: 60_000,
  });
  const filtered = clientId ? projects?.filter((p) => p.clientId === clientId) : projects;
  return (
    <div>
      <label className="label">Proyecto</label>
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
      >
        <option value="">(sin proyecto)</option>
        {filtered?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.jiraCode ? ` · ${p.jiraCode}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

function AudioFileCapture({
  onTranscribed,
}: {
  onTranscribed: (text: string, filename: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const mutation = useMutation({
    mutationFn: (f: File) => clientRequestsApi.transcribe(f),
    onSuccess: (r) => {
      if (file) onTranscribed(r.text.trim(), file.name);
      toast.success('Audio transcrito.');
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo transcribir el audio.'),
  });
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-slate-300 bg-slate-50">
      <UploadIcon size={18} className="text-slate-400" />
      <div className="flex-1 min-w-0">
        <input
          type="file"
          accept="audio/*,.opus,.m4a"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs"
        />
        <p className="text-[11px] text-slate-500 mt-1">
          Soporta nota de voz de WhatsApp (.opus, .m4a, .mp3). Máximo 25 MB.
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={!file}
        loading={mutation.isPending}
        onClick={() => file && mutation.mutate(file)}
      >
        Transcribir
      </Button>
    </div>
  );
}

function LiveMicCapture({ onTranscribed }: { onTranscribed: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  const mutation = useMutation({
    mutationFn: (f: File) => clientRequestsApi.transcribe(f),
    onSuccess: (r) => {
      onTranscribed(r.text.trim());
      toast.success('Transcripción lista.');
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo transcribir.'),
  });

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        const file = new File([blob], `request-${Date.now()}.webm`, { type: blob.type });
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mutation.mutate(file);
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    } catch {
      toast.error('No se pudo acceder al micrófono.');
    }
  };

  const stop = () => {
    mediaRef.current?.stop();
    mediaRef.current = null;
    setRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-slate-300 bg-slate-50">
      {!recording && !mutation.isPending && (
        <Button type="button" variant="primary" icon={<MicIcon size={16} />} onClick={start}>
          Empezar a grabar
        </Button>
      )}
      {recording && (
        <>
          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <span className="font-mono text-slate-700 tabular-nums">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </span>
          <Button type="button" variant="danger" onClick={stop}>
            Detener y transcribir
          </Button>
        </>
      )}
      {mutation.isPending && (
        <span className="flex items-center gap-2 text-sm text-slate-500">
          <RefreshIcon size={14} className="animate-spin" /> Transcribiendo…
        </span>
      )}
      {!recording && !mutation.isPending && (
        <p className="text-[11px] text-slate-500">
          Dicta tu solicitud. Al detener, se transcribe automáticamente con Whisper.
        </p>
      )}
    </div>
  );
}
