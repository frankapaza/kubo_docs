import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { meetingsApi } from '../api/meetings.api';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { MeetingTypeChecklist } from '../components/MeetingTypeGuide';
import { MEETING_TYPE_LABELS } from '../api/types';
import {
  ArrowLeftIcon,
  CheckIcon,
  DownloadIcon,
  InfoIcon,
  MicIcon,
  UploadIcon,
  XIcon,
} from '../components/ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

type Phase = 'idle' | 'recording' | 'paused' | 'stopped' | 'uploading';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const isSupported = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getDisplayMedia &&
  !!navigator.mediaDevices?.getUserMedia &&
  !!window.MediaRecorder;

export default function BrowserRecorderPage() {
  const { meetingId } = useParams();
  const mid = Number(meetingId);
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [includeMic, setIncludeMic] = useState(true);
  const [micLevel, setMicLevel] = useState(0);

  // Refs para mantener recursos de media a través de renders
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micRafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedAccumRef = useRef<number>(0);
  const pausedAtRef = useRef<number | null>(null);

  const { data: meeting } = useQuery({
    queryKey: ['meeting', mid],
    queryFn: () => meetingsApi.findOne(mid),
    enabled: Number.isFinite(mid) && mid > 0,
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!blob) throw new Error('Sin audio grabado');
      const file = new File([blob], `meet-${mid}-${Date.now()}.webm`, {
        type: blob.type || 'audio/webm',
      });
      setPhase('uploading');
      return meetingsApi.uploadAudio(mid, file);
    },
    onSuccess: () => {
      toast.success('Audio subido a Kubo. La transcripción inicia en segundos.');
      navigate(`/meetings/${mid}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      setPhase('stopped');
      toast.error(e.response?.data?.message ?? 'No se pudo subir el audio');
    },
  });

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      stopAllMediaTracks();
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Avisar si el usuario intenta cerrar la pestaña mientras graba
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused' && phase !== 'uploading') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  // Mantener sesión activa mientras graba: el timer de inactividad (useIdleLogout)
  // escucha eventos del document; disparar uno sintético cada 60s evita el logout.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const id = window.setInterval(() => {
      document.dispatchEvent(new MouseEvent('mousemove'));
    }, 60_000);
    return () => window.clearInterval(id);
  }, [phase]);

  if (!Number.isFinite(mid) || mid <= 0) return <Navigate to="/projects" replace />;
  if (!isSupported()) return <UnsupportedWarning />;

  const stopAllMediaTracks = () => {
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close().catch(() => {});
    displayStreamRef.current = null;
    micStreamRef.current = null;
    audioContextRef.current = null;
    destinationRef.current = null;
    micAnalyserRef.current = null;
    if (micRafRef.current) {
      cancelAnimationFrame(micRafRef.current);
      micRafRef.current = null;
    }
    setMicLevel(0);
  };

  const startTimer = () => {
    startTimeRef.current = Date.now();
    pausedAccumRef.current = 0;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      const now = Date.now();
      const paused = pausedAtRef.current ? now - pausedAtRef.current : 0;
      const total = (now - startTimeRef.current - pausedAccumRef.current - paused) / 1000;
      setElapsed(Math.max(0, total));
    }, 250);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      // 1) Capturar audio de un tab (getDisplayMedia pide video, pero solo usamos audio)
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1, height: 1 } as MediaTrackConstraints,
        audio: true,
      });

      // Si el usuario no marcó "Compartir audio del tab", no habrá track de audio
      if (displayStream.getAudioTracks().length === 0) {
        displayStream.getTracks().forEach((t) => t.stop());
        toast.error(
          '⚠️ No se capturó audio del tab. Al elegir la pestaña, asegúrate de marcar "Compartir audio de la pestaña".',
          'Compartir audio',
        );
        return;
      }

      displayStreamRef.current = displayStream;

      // 2) Capturar micrófono (opcional)
      // NOTA: echoCancellation apagado a propósito. Con tab-audio activo, Chrome
      // interpreta tu voz como eco del tab y la silencia. Si no usas auriculares
      // y la bocina hace loop, activa "apagar parlantes" o usa headset.
      let micStream: MediaStream | null = null;
      if (includeMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          micStreamRef.current = micStream;
        } catch {
          toast.warning(
            'No se pudo acceder al micrófono. Grabando solo audio del tab.',
          );
        }
      }

      // 3) Mezclar los dos streams con Web Audio API
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const destination = audioContext.createMediaStreamDestination();
      destinationRef.current = destination;

      const tabSource = audioContext.createMediaStreamSource(displayStream);
      tabSource.connect(destination);

      if (micStream) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        // Boost del mic: el tab suele salir más fuerte que el mic crudo.
        const micGain = audioContext.createGain();
        micGain.gain.value = 1.8;
        micSource.connect(micGain);
        micGain.connect(destination);

        // Analizador para medidor de nivel en vivo (no llega al destination).
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        micGain.connect(analyser);
        micAnalyserRef.current = analyser;
        const buffer = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!micAnalyserRef.current) return;
          micAnalyserRef.current.getByteTimeDomainData(buffer);
          let peak = 0;
          for (let i = 0; i < buffer.length; i++) {
            const v = Math.abs(buffer[i] - 128);
            if (v > peak) peak = v;
          }
          setMicLevel(Math.min(100, Math.round((peak / 128) * 100)));
          micRafRef.current = requestAnimationFrame(tick);
        };
        micRafRef.current = requestAnimationFrame(tick);
      }

      // 4) MediaRecorder sobre el stream mezclado
      const mimeType = pickBestMimeType();
      const mr = new MediaRecorder(destination.stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const finalBlob = new Blob(chunksRef.current, { type: mimeType });
        setBlob(finalBlob);
        const url = URL.createObjectURL(finalBlob);
        setBlobUrl(url);
        setPhase('stopped');
        stopTimer();
        stopAllMediaTracks();
      };

      // Si el usuario detiene la compartición desde el popup del navegador, paramos la grabación
      displayStream.getVideoTracks().forEach((t) => {
        t.onended = () => {
          if (mr.state !== 'inactive') mr.stop();
        };
      });

      mediaRecorderRef.current = mr;
      mr.start(1000); // emite chunks cada segundo
      setPhase('recording');
      startTimer();
      toast.success('Grabación iniciada');
    } catch (err) {
      const msg = (err as Error).message;
      stopAllMediaTracks();
      if (msg.includes('Permission') || msg.includes('denied') || msg.includes('NotAllowedError')) {
        toast.error('Permiso denegado. No se pudo iniciar la grabación.');
      } else {
        toast.error(`No se pudo iniciar la grabación: ${msg}`);
      }
    }
  };

  const pauseRecording = () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.pause();
    pausedAtRef.current = Date.now();
    setPhase('paused');
  };

  const resumeRecording = () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.resume();
    if (pausedAtRef.current) {
      pausedAccumRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }
    setPhase('recording');
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const discardRecording = async () => {
    const ok = await askConfirm({
      title: 'Descartar grabación',
      message: '¿Seguro que quieres descartar este audio? No se podrá recuperar.',
      confirmText: 'Descartar',
      tone: 'danger',
    });
    if (!ok) return;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlob(null);
    setBlobUrl(null);
    setElapsed(0);
    setPhase('idle');
    toast.info('Grabación descartada.');
  };

  const downloadBlob = () => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meet-${mid}-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('Descargando archivo…');
  };

  return (
    <div className="space-y-5">
      <div>
        <Link
          to={`/meetings/${mid}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeftIcon size={14} />
          Volver a la reunión
        </Link>
        <div className="mt-3">
          <h1 className="text-2xl font-bold text-slate-900">Grabar desde navegador</h1>
          <p className="text-sm text-slate-500 mt-1">
            Para <strong>{meeting?.title ?? `reunión #${mid}`}</strong>. Captura audio del tab del Meet + tu micrófono, los mezcla y sube a Kubo.
          </p>
        </div>
      </div>

      {phase === 'idle' && (
        <IdleView
          includeMic={includeMic}
          setIncludeMic={setIncludeMic}
          onStart={startRecording}
        />
      )}

      {(phase === 'recording' || phase === 'paused') && (
        <RecordingView
          phase={phase}
          elapsed={elapsed}
          micLevel={micLevel}
          micEnabled={includeMic && !!micStreamRef.current}
          onPause={pauseRecording}
          onResume={resumeRecording}
          onStop={stopRecording}
        />
      )}

      {(phase === 'stopped' || phase === 'uploading') && blob && (
        <StoppedView
          blob={blob}
          blobUrl={blobUrl}
          elapsed={elapsed}
          uploading={phase === 'uploading' || upload.isPending}
          onUpload={() => upload.mutate()}
          onDownload={downloadBlob}
          onDiscard={discardRecording}
        />
      )}

      {meeting && (
        <Card className="border-emerald-100">
          <CardHeader
            icon={<InfoIcon size={18} />}
            title={`Checklist — ${MEETING_TYPE_LABELS[meeting.meetingType]}`}
            subtitle="Marca cada punto mientras lo traten en la reunión. El estado se guarda en este navegador."
          />
          <CardBody>
            <MeetingTypeChecklist type={meeting.meetingType} meetingId={mid} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function IdleView({
  includeMic,
  setIncludeMic,
  onStart,
}: {
  includeMic: boolean;
  setIncludeMic: (v: boolean) => void;
  onStart: () => void;
}) {
  return (
    <>
      <Card className="border-2 border-blue-100 bg-blue-50/30">
        <CardBody>
          <h3 className="font-semibold text-slate-900 mb-2">📌 Antes de empezar</h3>
          <ol className="space-y-2 text-sm text-slate-700 list-decimal pl-5">
            <li>
              Abre tu reunión de Google Meet / Zoom Web / Teams en <strong>otra pestaña</strong> o ventana.
            </li>
            <li>Vuelve a esta pestaña y haz clic en <strong>"Iniciar grabación"</strong>.</li>
            <li>
              El navegador te pedirá elegir qué compartir. Selecciona la <strong>pestaña</strong> del meeting (no toda la pantalla) y activa la casilla:
              <div className="mt-1.5 inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs">
                <input type="checkbox" checked readOnly className="pointer-events-none" />
                <span className="font-semibold">Compartir audio del tab</span>
              </div>
            </li>
            <li>Vuelve al Meet para conducir la reunión. Kubo graba en segundo plano.</li>
            <li>Al terminar, vuelve a esta pestaña y haz clic en <strong>"Detener"</strong>.</li>
          </ol>
          <div className="mt-4 text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex items-start gap-2">
            <span className="text-amber-600 mt-0.5">⚠️</span>
            <span>
              <strong className="text-slate-700">No cierres esta pestaña</strong> mientras grabas o perderás el audio.
            </span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={<MicIcon size={18} />} title="Opciones" />
        <CardBody>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeMic}
              onChange={(e) => setIncludeMic(e.target.checked)}
              className="w-4 h-4"
            />
            <div>
              <p className="text-sm font-medium text-slate-900">
                Incluir mi micrófono
              </p>
              <p className="text-xs text-slate-500">
                Así también se graba tu voz (no solo la del Meet). Recomendado para meetings remotos.
              </p>
              <p className="text-[11px] text-amber-700 mt-1">
                Tip: usa auriculares. Sin ellos, la bocina puede colarse en el mic y sonar con eco.
              </p>
            </div>
          </label>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          icon={<MicIcon size={18} />}
          onClick={onStart}
          className="!px-6 !py-3 !text-base"
        >
          Iniciar grabación
        </Button>
      </div>
    </>
  );
}

function RecordingView({
  phase,
  elapsed,
  micLevel,
  micEnabled,
  onPause,
  onResume,
  onStop,
}: {
  phase: 'recording' | 'paused';
  elapsed: number;
  micLevel: number;
  micEnabled: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const micActive = micEnabled && phase === 'recording';
  const micHasSignal = micActive && micLevel > 4;
  return (
    <Card
      className={`border-2 ${phase === 'recording' ? 'border-red-200 bg-red-50/30' : 'border-amber-200 bg-amber-50/30'}`}
    >
      <CardBody className="py-10 text-center">
        <div className="flex items-center justify-center gap-3 mb-4">
          <span
            className={`w-3 h-3 rounded-full ${phase === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`}
          />
          <p className="text-sm font-semibold uppercase tracking-wider text-slate-700">
            {phase === 'recording' ? 'Grabando' : 'En pausa'}
          </p>
        </div>
        <p className="text-5xl font-bold text-slate-900 font-mono tabular-nums">
          {formatTime(elapsed)}
        </p>
        <p className="text-xs text-slate-500 mt-3">
          No cierres esta pestaña · el audio del Meet + tu mic se están mezclando
        </p>

        {micEnabled && (
          <div className="max-w-md mx-auto mt-6">
            <div className="flex items-center gap-3">
              <MicIcon
                size={16}
                className={micHasSignal ? 'text-emerald-600' : 'text-slate-400'}
              />
              <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-[width] duration-75 ${
                    micLevel > 75
                      ? 'bg-red-500'
                      : micLevel > 40
                        ? 'bg-emerald-500'
                        : 'bg-emerald-400'
                  }`}
                  style={{ width: `${micLevel}%` }}
                />
              </div>
              <span
                className={`text-[11px] font-mono tabular-nums w-10 text-right ${
                  micHasSignal ? 'text-emerald-700' : 'text-slate-400'
                }`}
              >
                {Math.round(micLevel)}%
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              {phase === 'paused'
                ? 'Medidor pausado'
                : micHasSignal
                  ? 'Mic captando audio'
                  : 'Habla para verificar que tu mic se escucha'}
            </p>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 mt-8">
          {phase === 'recording' ? (
            <Button variant="secondary" onClick={onPause}>
              ⏸️ Pausar
            </Button>
          ) : (
            <Button variant="secondary" onClick={onResume}>
              ▶️ Reanudar
            </Button>
          )}
          <Button
            variant="danger"
            onClick={onStop}
            className="!px-6"
          >
            ⏹️ Detener grabación
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function StoppedView({
  blob,
  blobUrl,
  elapsed,
  uploading,
  onUpload,
  onDownload,
  onDiscard,
}: {
  blob: Blob;
  blobUrl: string | null;
  elapsed: number;
  uploading: boolean;
  onUpload: () => void;
  onDownload: () => void;
  onDiscard: () => void;
}) {
  return (
    <Card>
      <CardHeader
        icon={<CheckIcon size={18} />}
        title="Grabación finalizada"
        subtitle="Revisa el audio y decide qué hacer con él."
      />
      <CardBody>
        <div className="flex items-center gap-4 mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <MicIcon size={18} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900">
              Duración: {formatTime(elapsed)}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Tamaño: {formatBytes(blob.size)} · Formato: {blob.type || 'audio/webm'}
            </p>
          </div>
        </div>

        {blobUrl && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Vista previa
            </p>
            <audio src={blobUrl} controls className="w-full" />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <Button
            icon={<UploadIcon size={16} />}
            onClick={onUpload}
            loading={uploading}
          >
            Subir a Kubo y transcribir
          </Button>
          <Button
            variant="secondary"
            icon={<DownloadIcon size={16} />}
            onClick={onDownload}
            disabled={uploading}
          >
            Descargar solo
          </Button>
          <Button
            variant="ghost"
            icon={<XIcon size={16} />}
            onClick={onDiscard}
            disabled={uploading}
          >
            Descartar
          </Button>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          <strong className="text-slate-600">Subir a Kubo</strong>: el audio se transcribe y queda asociado a esta reunión.
          <strong className="text-slate-600"> Descargar solo</strong>: te guardas el archivo sin subirlo a ningún servidor.
          <strong className="text-slate-600"> Descartar</strong>: se borra de la memoria del navegador.
        </p>
      </CardBody>
    </Card>
  );
}

function UnsupportedWarning() {
  return (
    <div className="max-w-2xl mx-auto mt-10">
      <Card className="border-2 border-amber-200 bg-amber-50/30">
        <CardBody className="py-8 text-center">
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            Tu navegador no soporta la grabación de tab
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Esta función necesita <strong>getDisplayMedia con audio</strong>, que solo está disponible en navegadores basados en Chromium: <strong>Chrome, Edge, Brave, Opera</strong>.
          </p>
          <p className="text-sm text-slate-500 mt-3">
            Firefox tiene soporte limitado, Safari aún no lo soporta. Mientras tanto puedes grabar el Meet con otra herramienta y subir el archivo manualmente desde el detalle de la reunión.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function pickBestMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    '',
  ];
  for (const c of candidates) {
    if (c === '' || MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}
