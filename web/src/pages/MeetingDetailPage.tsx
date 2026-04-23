import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actasApi, meetingsApi } from '../api/meetings.api';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import {
  ActaStatusBadge,
  MeetingStatusBadge,
  MeetingTypeBadge,
  TranscriptionStatusBadge,
} from '../components/ui/Badge';
import { MeetingParticipantsCard } from '../components/MeetingParticipantsCard';
import { MeetingTypeGuideContent } from '../components/MeetingTypeGuide';
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  FileTextIcon,
  InfoIcon,
  LocationIcon,
  MicIcon,
  RefreshIcon,
  UploadIcon,
  XIcon,
} from '../components/ui/Icon';
import { MEETING_TYPE_LABELS } from '../api/types';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

export default function MeetingDetailPage() {
  const { meetingId } = useParams();
  const mid = Number(meetingId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadMsg, setUploadMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { data: meeting, refetch: refetchMeeting } = useQuery({
    queryKey: ['meeting', mid],
    queryFn: () => meetingsApi.findOne(mid),
  });

  const closeMeeting = useMutation({
    mutationFn: () => meetingsApi.close(mid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meeting', mid] });
      qc.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
  const reopenMeeting = useMutation({
    mutationFn: () => meetingsApi.reopen(mid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meeting', mid] });
      qc.invalidateQueries({ queryKey: ['meetings'] });
    },
  });

  const { data: acta } = useQuery({
    queryKey: ['meeting-acta', mid],
    queryFn: () => meetingsApi.getActa(mid),
  });

  const { data: audio, refetch: refetchAudio } = useQuery({
    queryKey: ['meeting-audio', mid],
    queryFn: () => meetingsApi.getAudio(mid),
  });

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioErr, setAudioErr] = useState<string | null>(null);

  useEffect(() => {
    if (!audio || audio.deletedAt) {
      setAudioUrl(null);
      return;
    }
    let revoked = false;
    let url: string | null = null;
    setAudioLoading(true);
    setAudioErr(null);
    meetingsApi
      .getAudioBlobUrl(audio.id)
      .then((u) => {
        if (revoked) {
          URL.revokeObjectURL(u);
          return;
        }
        url = u;
        setAudioUrl(u);
      })
      .catch(() => setAudioErr('No se pudo cargar el audio'))
      .finally(() => setAudioLoading(false));
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
      setAudioUrl(null);
    };
  }, [audio?.id, audio?.deletedAt]);

  const { data: transcription, refetch: refetchTrans } = useQuery({
    queryKey: ['transcription', mid],
    queryFn: () => meetingsApi.getTranscription(mid),
    refetchInterval: (q) => {
      const t = q.state.data;
      if (!t) return false;
      return t.status === 'PENDING' || t.status === 'PROCESSING' ? 5000 : false;
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => meetingsApi.uploadAudio(mid, file),
    onSuccess: () => {
      setUploadMsg({ tone: 'success', text: 'Audio subido. Transcripción encolada.' });
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = '';
      refetchMeeting();
      refetchTrans();
      refetchAudio();
    },
    onError: () => setUploadMsg({ tone: 'error', text: 'Error al subir el audio.' }),
  });

  const generateActa = useMutation({
    mutationFn: () => meetingsApi.generateActa(mid),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['meeting-acta', mid] });
      navigate(`/actas/${a.id}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo generar el acta'),
  });

  if (!meeting) {
    return (
      <Card>
        <div className="p-12 text-center text-sm text-slate-400">Cargando reunión…</div>
      </Card>
    );
  }

  const isClosed = meeting.status === 'CLOSED';
  const date = new Date(meeting.scheduledAt);

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/projects/${meeting.projectId}/meetings`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeftIcon size={14} />
          Volver a reuniones
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap mt-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{meeting.title}</h1>
              <MeetingStatusBadge status={meeting.status} />
              {meeting.meetingType && meeting.meetingType !== 'GENERIC' && (
                <MeetingTypeBadge type={meeting.meetingType} />
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-slate-500 flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon size={14} />
                {date.toLocaleString('es', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              {meeting.location && (
                <span className="inline-flex items-center gap-1.5">
                  <LocationIcon size={14} />
                  {meeting.location}
                </span>
              )}
            </div>
          </div>
          <div>
            {isClosed ? (
              <Button
                variant="success"
                icon={<CheckIcon size={16} />}
                onClick={() => reopenMeeting.mutate()}
                loading={reopenMeeting.isPending}
              >
                Reabrir reunión
              </Button>
            ) : (
              <Button
                variant="warning"
                icon={<XIcon size={16} />}
                onClick={async () => {
                  const ok = await askConfirm({
                    title: 'Cerrar reunión',
                    message: `¿Cerrar la reunión "${meeting.title}"?`,
                    confirmText: 'Cerrar',
                    tone: 'warning',
                  });
                  if (ok) closeMeeting.mutate();
                }}
                loading={closeMeeting.isPending}
              >
                Cerrar reunión
              </Button>
            )}
          </div>
        </div>
      </div>

      <Card>
        <details className="group">
          <summary className="cursor-pointer list-none px-5 py-4 flex items-center gap-3 hover:bg-slate-50 transition rounded-xl">
            <div className="w-9 h-9 rounded-lg bg-kubo-primary-light text-kubo-primary flex items-center justify-center flex-shrink-0">
              <InfoIcon size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 text-sm">
                Cómo armar un acta de {MEETING_TYPE_LABELS[meeting.meetingType].toLowerCase()}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Ejemplo y puntos que conviene cubrir durante la reunión
              </p>
            </div>
            <span className="text-xs text-slate-400 group-open:hidden">Ver</span>
            <span className="text-xs text-slate-400 hidden group-open:inline">Ocultar</span>
          </summary>
          <div className="px-5 pb-5 pt-1 border-t border-slate-100">
            <MeetingTypeGuideContent type={meeting.meetingType} />
          </div>
        </details>
      </Card>

      <MeetingParticipantsCard meetingId={mid} projectId={meeting.projectId} />

      <Card>
        <CardHeader
          icon={<MicIcon size={18} />}
          title="Audio"
          subtitle={
            audio && !audio.deletedAt
              ? 'Reproduce o descarga el audio grabado de la reunión'
              : 'Sube un archivo de audio para transcribir la reunión'
          }
        />
        <CardBody>
          {audio && !audio.deletedAt && (
            <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {audio.originalFilename}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {formatBytes(audio.sizeBytes)}
                    {audio.durationSeconds != null && ` · ${formatDuration(audio.durationSeconds)}`}
                    {' · subido '}
                    {new Date(audio.createdAt).toLocaleString('es', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<DownloadIcon size={14} />}
                  onClick={async () => {
                    const url = await meetingsApi.getAudioBlobUrl(audio.id);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = audio.originalFilename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Descargar
                </Button>
              </div>
              {audioLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 py-3">
                  <RefreshIcon size={16} className="animate-spin" />
                  Cargando audio…
                </div>
              ) : audioErr ? (
                <p className="text-sm text-red-600">{audioErr}</p>
              ) : audioUrl ? (
                <audio controls src={audioUrl} className="w-full" preload="metadata" />
              ) : null}
            </div>
          )}

          {audio?.deletedAt && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
              <ArchiveIcon size={18} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-900">
                  Audio eliminado por política de retención
                </p>
                <p className="text-xs text-amber-800 mt-0.5">
                  <ClockIcon size={12} className="inline mr-1" />
                  {new Date(audio.deletedAt).toLocaleString('es', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' — '}
                  {describeDeletedReason(audio.deletedReason)}
                </p>
                <p className="text-xs text-amber-800 mt-1">
                  La transcripción sigue disponible. Puedes subir otro audio si lo necesitas.
                </p>
              </div>
            </div>
          )}

          <label
            htmlFor="audio-upload"
            className={`flex items-center gap-4 border-2 border-dashed rounded-xl px-5 py-6 cursor-pointer transition ${
              selectedFile
                ? 'border-kubo-primary bg-kubo-primary-light/40'
                : 'border-slate-300 hover:border-kubo-primary hover:bg-slate-50'
            }`}
          >
            <div className="w-11 h-11 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500">
              <UploadIcon size={20} />
            </div>
            <div className="flex-1 min-w-0">
              {selectedFile ? (
                <>
                  <p className="font-medium text-slate-900 truncate">{selectedFile.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-slate-700">Selecciona un archivo de audio</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    MP3, WAV, M4A, OGG, WEBM — hasta 100 MB
                  </p>
                </>
              )}
            </div>
            <input
              id="audio-upload"
              ref={fileRef}
              type="file"
              accept="audio/*"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>

          <div className="flex items-center justify-between gap-3 mt-4">
            <div className="text-sm">
              {uploadMsg && (
                <span
                  className={
                    uploadMsg.tone === 'success' ? 'text-emerald-700' : 'text-red-600'
                  }
                >
                  {uploadMsg.text}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                icon={<MicIcon size={16} />}
                onClick={() => navigate(`/meetings/${mid}/record-web`)}
              >
                Grabar desde navegador
              </Button>
              <Button
                variant="primary"
                icon={<UploadIcon size={16} />}
                onClick={() => selectedFile && upload.mutate(selectedFile)}
                loading={upload.isPending}
                disabled={!selectedFile}
              >
                Subir audio
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<FileTextIcon size={18} />}
          title="Transcripción"
          subtitle="Se actualiza automáticamente cuando Whisper termine"
          action={
            transcription ? <TranscriptionStatusBadge status={transcription.status} /> : null
          }
        />
        <CardBody>
          {!transcription ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              Aún no hay audio. Sube uno para generar la transcripción.
            </p>
          ) : transcription.status === 'COMPLETED' ? (
            <pre className="whitespace-pre-wrap text-sm bg-slate-50 border border-slate-200 text-slate-700 p-4 rounded-lg font-sans leading-relaxed max-h-96 overflow-auto">
              {transcription.contentText}
            </pre>
          ) : transcription.status === 'FAILED' ? (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              <p className="font-medium">Error al transcribir</p>
              <p className="mt-1">{transcription.errorMessage ?? 'Sin detalles'}</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm text-slate-500 py-4">
              <RefreshIcon size={16} className="animate-spin" />
              <span>Procesando… se actualiza cada pocos segundos.</span>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<FileTextIcon size={18} />}
          title="Acta"
          subtitle={
            acta
              ? `Versión ${acta.version} · sigue revisando hasta su aprobación`
              : 'Genera un borrador a partir de la transcripción'
          }
          action={acta ? <ActaStatusBadge status={acta.status} /> : null}
        />
        <CardBody>
          {!acta ? (
            !transcription || transcription.status !== 'COMPLETED' ? (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <p className="text-sm text-slate-500">
                  Necesitas una transcripción completada antes de generar el acta.
                </p>
                <Button
                  variant="success"
                  icon={<FileTextIcon size={16} />}
                  disabled
                >
                  Generar borrador
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <p className="text-sm text-slate-500">
                  Se creará un borrador en Markdown que podrás editar, enviar a revisión y aprobar.
                </p>
                <Button
                  variant="success"
                  icon={<FileTextIcon size={16} />}
                  onClick={() => generateActa.mutate()}
                  loading={generateActa.isPending}
                >
                  Generar borrador
                </Button>
              </div>
            )
          ) : acta.status === 'DRAFT' ? (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-slate-500">
                Hay un borrador en progreso. Continúa editándolo hasta enviarlo a revisión.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  icon={<RefreshIcon size={16} />}
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: 'Regenerar acta',
                      message: 'Se reemplazará el borrador con uno nuevo a partir de la transcripción. ¿Continuar?',
                      confirmText: 'Regenerar',
                      tone: 'warning',
                    });
                    if (ok) generateActa.mutate();
                  }}
                  loading={generateActa.isPending}
                  disabled={!transcription || transcription.status !== 'COMPLETED'}
                >
                  Regenerar
                </Button>
                <Button
                  variant="primary"
                  trailingIcon={<ArrowRightIcon size={16} />}
                  onClick={() => navigate(`/actas/${acta.id}`)}
                >
                  Continuar edición
                </Button>
              </div>
            </div>
          ) : acta.status === 'IN_REVIEW' ? (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-slate-500">
                El acta está en revisión. Los participantes pueden firmarla desde el detalle.
              </p>
              <Button
                variant="primary"
                trailingIcon={<ArrowRightIcon size={16} />}
                onClick={() => navigate(`/actas/${acta.id}`)}
              >
                Revisar y firmar
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-slate-500">
                El acta fue aprobada. Ya no se puede modificar, pero puedes consultarla o descargar el PDF.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  icon={<DownloadIcon size={16} />}
                  onClick={() => actasApi.downloadPdf(acta.id)}
                >
                  Descargar PDF
                </Button>
                <Button
                  variant="primary"
                  trailingIcon={<ArrowRightIcon size={16} />}
                  onClick={() => navigate(`/actas/${acta.id}`)}
                >
                  Ver acta
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function describeDeletedReason(reason: string | null): string {
  switch (reason) {
    case 'NEVER_STORE':
      return 'política "nunca guardar audio"';
    case 'AFTER_APPROVAL':
      return 'borrado tras aprobación del acta';
    case 'AFTER_DAYS':
      return 'expiró el plazo de retención';
    case 'MANUAL':
      return 'borrado manual';
    default:
      return 'motivo desconocido';
  }
}
