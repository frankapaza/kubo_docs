import { useEffect, useRef, useState } from 'react';

import { ticketsApi, clientSystemsApi } from '../../api/tickets.api';
import { ticketMessagesApi } from '../../api/ticket-messages.api';
import { clientsApi } from '../../api/clients.api';
import { projectsApi } from '../../api/projects.api';
import type {
  Client,
  ClientSystem,
  CreatedTicket,
  Project,
  ServiceCategory,
  Ticket,
  TicketImpact,
  TicketOrigin,
  TicketUrgency,
} from '../../api/types';
import { SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS } from '../../api/types';
import {
  FileDropZone,
  uploadPendingAttachments,
  type PendingAttachment,
  type RejectedAttachment,
} from '../../components/upload';
import { withTimeout } from '../../lib/with-timeout';
import { ORIGIN_LABELS, PRIORITY_STYLES, TICKET_IMPACTS, TICKET_URGENCIES, previewPriority } from './ticket-ui';

/** Los adjuntos pueden ser de 10 MB y van de uno en uno: se acota por archivo. */
const UPLOAD_TIMEOUT_MS_PER_FILE = 60_000;

type CaptureMode = 'text' | 'audio' | 'live';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreated: (ticket: Ticket) => void;
}

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: '8px 10px',
  border: '1px solid #dfe3e4',
  borderRadius: 6,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 5, display: 'block' };

export default function NewTicketDialog({ open, onCancel, onCreated }: Props) {
  const [mode, setMode] = useState<CaptureMode>('text');
  const [rawText, setRawText] = useState('');
  const [subject, setSubject] = useState('');
  const [origin, setOrigin] = useState<TicketOrigin>('NOTE');
  const [serviceCategory, setServiceCategory] = useState<ServiceCategory | ''>('');
  const [impact, setImpact] = useState<TicketImpact | ''>('');
  const [urgency, setUrgency] = useState<TicketUrgency | ''>('');
  const [clientId, setClientId] = useState<number | ''>('');
  const [projectId, setProjectId] = useState<number | ''>('');
  const [systemId, setSystemId] = useState<number | ''>('');

  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [systems, setSystems] = useState<ClientSystem[]>([]);
  const [files, setFiles] = useState<PendingAttachment[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * El ticket **ya creado** cuyo diálogo se retiene para contar qué pasó con sus
   * archivos. Sin esto, un adjunto que no subió se perdía sin dejar rastro: el
   * alta cierra el diálogo y con él el único sitio donde contarlo.
   */
  const [createdTicket, setCreatedTicket] = useState<CreatedTicket | null>(null);
  const [attachmentIssues, setAttachmentIssues] = useState<RejectedAttachment[]>([]);

  const rawTextRef = useRef<HTMLTextAreaElement>(null);

  /** `key` del `FileDropZone`: la zona guarda sus propios rechazos, que este componente no ve. */
  const [dropZoneEpoch, setDropZoneEpoch] = useState(0);

  /** Corta el camino tardío tras desmontar: la subida puede durar minutos. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Guarda **síncrona** contra el doble envío, además del `disabled={busy}`.
   *
   * El doble clic corriente ya lo cubre `disabled` --el clic es discreto y React
   * 18 vacía el estado antes del segundo--, así que **no hay un duplicado
   * demostrado**. Se queda porque cuesta una línea y porque crear un ticket no
   * se deshace, y porque esa cobertura depende de cómo React despache los
   * eventos y no de nada que se afirme aquí. Misma guarda que los compositores
   * del hilo y que el diálogo de alta del portal.
   */
  const inFlight = useRef(false);

  // Resetea el formulario cada vez que el diálogo se abre; se mantiene
  // montado (igual que ResolveDialog) para no perder el `useEffect` de
  // Escape entre aperturas.
  useEffect(() => {
    if (!open) return;
    setMode('text');
    setRawText('');
    setSubject('');
    setOrigin('NOTE');
    setServiceCategory('');
    setImpact('');
    setUrgency('');
    setClientId('');
    setProjectId('');
    setSystemId('');
    setError(null);
    setFiles([]);
    setCreatedTicket(null);
    setAttachmentIssues([]);
    setDropZoneEpoch((epoch) => epoch + 1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    clientsApi
      .list({ status: 'CLIENT' })
      .then((list) => {
        if (!cancelled) setClients(list);
      })
      .catch((e) => {
        if (!cancelled) console.warn('[NewTicketDialog] No se pudo cargar la lista de clientes.', e);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Proyectos activos, filtrados por cliente cuando hay uno elegido.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    projectsApi
      .list({ status: 'ACTIVE', clientId: clientId || undefined })
      .then((p) => {
        if (!cancelled) setProjects(p.data);
      })
      .catch((e) => {
        if (!cancelled) console.warn('[NewTicketDialog] No se pudo cargar la lista de proyectos.', e);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  // Sistemas del cliente elegido; el select se deshabilita sin cliente.
  useEffect(() => {
    if (!open || !clientId) {
      setSystems([]);
      return;
    }
    let cancelled = false;
    clientSystemsApi
      .list(clientId)
      .then((list) => {
        if (!cancelled) setSystems(list.filter((s) => s.isActive === 1));
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('[NewTicketDialog] No se pudo cargar los sistemas del cliente.', e);
          setSystems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  /**
   * Cerrar por ESC o por el fondo. Con algo en vuelo no se cierra --se llevaría
   * el informe de los archivos--, y con el ticket ya creado cerrar es *seguir*
   * hasta él, no cancelar: el ticket existe y la bandeja tiene que enterarse.
   */
  const dismiss = () => {
    if (busy) return;
    if (createdTicket) {
      onCreated(createdTicket);
      return;
    }
    onCancel();
  };

  // Cerrar con ESC — mismo idioma que ResolveDialog / ConfirmDialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // Las que mira `dismiss`: sin `busy` ni `createdTicket` el oyente cerraría
    // el diálogo en mitad de una subida.
  }, [open, busy, createdTicket, onCancel, onCreated]);

  if (!open) return null;

  const priority = previewPriority(impact, urgency);
  const pr = PRIORITY_STYLES[priority];

  const submit = async () => {
    // La guarda, antes que nada y sin ningún `await` por delante.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await create();
    } finally {
      inFlight.current = false;
    }
  };

  const create = async () => {
    if (!rawText.trim()) {
      setError('El texto es obligatorio.');
      return;
    }

    // Se capturan aquí: la lista se vacía en cuanto el ticket existe y la
    // subida sigue necesitándolos.
    const pending = files;

    setBusy(true);
    setError(null);
    setAttachmentIssues([]);

    let created: CreatedTicket;
    try {
      created = await ticketsApi.create({
        rawText: rawText.trim(),
        subject: subject.trim() || undefined,
        origin,
        serviceCategory: serviceCategory || undefined,
        impact: impact || undefined,
        urgency: urgency || undefined,
        clientId: clientId || undefined,
        projectId: projectId || undefined,
        systemId: systemId || undefined,
      });
    } catch (e: any) {
      if (alive.current) {
        setError(e?.response?.data?.message ?? 'No se pudo crear el ticket');
        setBusy(false);
      }
      return;
    }

    if (!alive.current) return;

    // ------------------------------------------------------------------
    // El ticket **existe** y eso no se deshace. Lo que pase con los adjuntos ya
    // no es un fallo de alta, y no puede contarse como tal: «no se pudo crear
    // el ticket» mandaría a crear un duplicado del que sí está creado.
    // ------------------------------------------------------------------
    setFiles([]);
    setDropZoneEpoch((epoch) => epoch + 1);

    if (pending.length === 0) {
      setBusy(false);
      onCreated(created);
      return;
    }

    let issues: RejectedAttachment[];
    try {
      const outcome = await withTimeout(
        // Contra el primer mensaje del hilo, que el alta acaba de escribir.
        uploadPendingAttachments(ticketMessagesApi, created.id, created.firstMessageId, pending),
        UPLOAD_TIMEOUT_MS_PER_FILE * pending.length,
      );
      issues = [...outcome.failed, ...outcome.skipped];
    } catch {
      // `uploadPendingAttachments` no rechaza por su cuenta, así que caer aquí
      // solo puede ser el corte de tiempo. No se afirma que no subieran: no se
      // sabe cuáles llegaron.
      issues = pending.map((item) => ({
        id: item.id,
        filename: item.file.name,
        code: 'TIMEOUT',
        message:
          `«${item.file.name}»: el servidor no respondió a tiempo. ` +
          'Puede haberse adjuntado o no; abre el ticket para comprobarlo.',
      }));
    }

    if (!alive.current) return;
    setBusy(false);

    if (issues.length === 0) {
      onCreated(created);
      return;
    }

    setAttachmentIssues(issues);
    setCreatedTicket(created);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-ticket-dialog-title"
      onClick={dismiss}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', zIndex: 50, overflowY: 'auto' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, padding: 22, width: 680, maxWidth: '96vw', display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div>
          <h2 id="new-ticket-dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            Nuevo ticket
          </h2>
          <span style={{ fontSize: 12, color: '#6d7577' }}>
            Captura el texto tal como llega. Podrás estructurarlo con IA después de crearlo.
          </span>
        </div>

        {error && (
          <div role="alert" style={{ fontSize: 12, color: 'oklch(0.5 0.16 25)', background: 'oklch(0.96 0.02 25)', border: '1px solid oklch(0.88 0.05 25)', borderRadius: 6, padding: '8px 10px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #eceeef' }}>
          {(['text', 'audio', 'live'] as CaptureMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: '8px 10px',
                border: 'none',
                borderBottom: mode === m ? '2px solid #15191a' : '2px solid transparent',
                background: 'transparent',
                color: mode === m ? '#15191a' : '#6d7577',
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {m === 'text' && 'Texto'}
              {m === 'audio' && 'Archivo de audio'}
              {m === 'live' && 'Grabar ahora'}
            </button>
          ))}
        </div>

        {mode === 'audio' && (
          <AudioFileCapture
            onTranscribed={(text) => {
              setRawText(text);
              setOrigin('WHATSAPP_AUDIO');
              setMode('text');
            }}
          />
        )}
        {mode === 'live' && (
          <LiveMicCapture
            onTranscribed={(text) => {
              setRawText(text);
              setOrigin('VOICE_LIVE');
              setMode('text');
            }}
          />
        )}

        <label htmlFor="new-ticket-rawtext">
          <span style={labelStyle}>Texto de la solicitud *</span>
          <textarea
            id="new-ticket-rawtext"
            ref={rawTextRef}
            value={rawText}
            disabled={busy}
            onChange={(e) => setRawText(e.target.value)}
            rows={5}
            placeholder="Pega el WhatsApp o el correo, o escribe la solicitud tal cual te la contaron…"
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </label>

        <div>
          <span style={labelStyle}>Archivos adjuntos (opcional)</span>
          <FileDropZone
            key={dropZoneEpoch}
            files={files}
            onFilesChange={setFiles}
            disabled={busy || createdTicket !== null}
            pasteScope={rawTextRef}
            hint={
              /*
                Decirlo aquí no es un adorno: el texto y los archivos del alta
                quedan como **nota interna**, porque `raw_text` en un alta del
                panel es la captura en crudo y el cliente no la ve (lo decide
                `firstMessageVisibility` en el backend). Quien arrastra aquí un
                volcado de logs tiene que saber dónde acaba -- y quien quiera
                hacerle llegar algo al cliente tiene la conversación del ticket,
                con sus dos botones y su confirmación.
              */
              <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: '#6d7577' }}>
                Quedan como nota interna: el cliente no los ve. Para hacerle llegar algo,
                respóndele desde la conversación del ticket.
              </span>
            }
          />
        </div>

        <label htmlFor="new-ticket-subject">
          <span style={labelStyle}>Asunto (opcional)</span>
          <input
            id="new-ticket-subject"
            type="text"
            value={subject}
            maxLength={240}
            onChange={(e) => setSubject(e.target.value)}
            style={inputStyle}
          />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <label htmlFor="new-ticket-client">
            <span style={labelStyle}>Cliente</span>
            <select
              id="new-ticket-client"
              value={clientId}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : '';
                setClientId(v);
                setProjectId('');
                setSystemId('');
              }}
              style={inputStyle}
            >
              <option value="">(sin cliente)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razonSocial}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="new-ticket-project">
            <span style={labelStyle}>Proyecto</span>
            <select
              id="new-ticket-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')}
              style={inputStyle}
            >
              <option value="">(sin proyecto)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="new-ticket-system">
            <span style={labelStyle}>Sistema</span>
            <select
              id="new-ticket-system"
              value={systemId}
              disabled={!clientId}
              onChange={(e) => setSystemId(e.target.value ? Number(e.target.value) : '')}
              style={{ ...inputStyle, cursor: clientId ? 'pointer' : 'not-allowed', background: clientId ? '#fff' : '#f5f6f6' }}
            >
              <option value="">{clientId ? '(sin sistema)' : 'Elige un cliente primero'}</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label htmlFor="new-ticket-category">
            <span style={labelStyle}>Categoría de servicio</span>
            <select
              id="new-ticket-category"
              value={serviceCategory}
              onChange={(e) => setServiceCategory((e.target.value as ServiceCategory) || '')}
              style={inputStyle}
            >
              <option value="">(sin categoría)</option>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SERVICE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="new-ticket-origin">
            <span style={labelStyle}>Origen</span>
            <select
              id="new-ticket-origin"
              value={origin}
              onChange={(e) => setOrigin(e.target.value as TicketOrigin)}
              style={inputStyle}
            >
              {(Object.keys(ORIGIN_LABELS) as TicketOrigin[]).map((o) => (
                <option key={o} value={o}>
                  {ORIGIN_LABELS[o]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
          <label htmlFor="new-ticket-impact">
            <span style={labelStyle}>Impacto</span>
            <select
              id="new-ticket-impact"
              value={impact}
              onChange={(e) => setImpact((e.target.value as TicketImpact) || '')}
              style={inputStyle}
            >
              <option value="">(sin definir)</option>
              {TICKET_IMPACTS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="new-ticket-urgency">
            <span style={labelStyle}>Urgencia</span>
            <select
              id="new-ticket-urgency"
              value={urgency}
              onChange={(e) => setUrgency((e.target.value as TicketUrgency) || '')}
              style={inputStyle}
            >
              <option value="">(sin definir)</option>
              {TICKET_URGENCIES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span style={labelStyle}>Prioridad resultante</span>
            <div
              title="Se recalcula en el servidor al crear el ticket; esto es solo una previsualización."
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600, padding: '8px 10px', borderRadius: 6, background: pr.bg, color: pr.fg, textAlign: 'center' }}
            >
              {priority}
            </div>
          </div>
        </div>
        {(!impact || !urgency) && (
          <span style={{ fontSize: 11, color: '#6d7577', marginTop: -10 }}>
            Sin impacto y urgencia definidos, el ticket se crea en P3 por defecto.
          </span>
        )}

        {/*
          El ticket ya está creado: queda contar qué pasó con los archivos. El
          titular va primero para que esto no se lea nunca como «no se creó»,
          que llevaría a crear un duplicado del que ya existe.
        */}
        {attachmentIssues.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'oklch(0.45 0.11 75)' }}>
              El ticket sí se creó. Con los archivos pasó esto:
            </span>
            {attachmentIssues.map((issue) => (
              <span
                key={issue.id}
                role="alert"
                data-error-code={issue.code}
                style={{ fontSize: 12, color: 'oklch(0.4 0.09 75)', background: 'oklch(0.97 0.03 75)', border: '1px solid oklch(0.88 0.06 75)', borderRadius: 6, padding: '7px 10px' }}
              >
                {issue.message}
              </span>
            ))}
            <span style={{ fontSize: 11, color: '#6d7577' }}>
              Puedes adjuntarlos desde la conversación del ticket.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #eceeef', paddingTop: 14 }}>
          {createdTicket ? (
            <button
              type="button"
              onClick={() => onCreated(createdTicket)}
              style={{ fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: '#15191a', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Ver el ticket
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                style={{ fontSize: 13, padding: '9px 14px', borderRadius: 7, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy || !rawText.trim()}
                onClick={submit}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '9px 14px',
                  borderRadius: 7,
                  background: busy || !rawText.trim() ? '#c9cdce' : '#15191a',
                  color: '#fff',
                  border: 'none',
                  cursor: busy || !rawText.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {busy ? 'Creando…' : 'Crear ticket'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Captura por audio — mismo enfoque que RequestsListPage (Tarea 13, borrada
// en la Tarea 16): un fichero se sube y transcribe de una vez; la grabación
// en vivo usa MediaRecorder y transcribe al detener. Adaptado al estilo
// inline de las páginas de tickets, sin react-query.
// ---------------------------------------------------------------------------

function AudioFileCapture({ onTranscribed }: { onTranscribed: (text: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcribe = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ticketsApi.transcribe(file);
      onTranscribed(r.text.trim());
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo transcribir el audio.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 8, border: '1px dashed #d8dcdd', background: '#fafbfb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input
          type="file"
          accept="audio/*,.opus,.m4a"
          aria-label="Archivo de audio a transcribir"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ fontSize: 12 }}
        />
        <button
          type="button"
          disabled={!file || busy}
          onClick={transcribe}
          style={{ fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 6, background: !file || busy ? '#c9cdce' : '#15191a', color: '#fff', border: 'none', cursor: !file || busy ? 'not-allowed' : 'pointer' }}
        >
          {busy ? 'Transcribiendo…' : 'Transcribir'}
        </button>
      </div>
      <span style={{ fontSize: 11, color: '#6d7577' }}>
        Nota de voz de WhatsApp (.opus, .m4a, .mp3) u otro audio. Máximo 25 MB.
      </span>
      {error && <span role="alert" style={{ fontSize: 12, color: 'oklch(0.5 0.16 25)' }}>{error}</span>}
    </div>
  );
}

function LiveMicCapture({ onTranscribed }: { onTranscribed: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        const file = new File([blob], `ticket-${Date.now()}.webm`, { type: blob.type });
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setBusy(true);
        try {
          const r = await ticketsApi.transcribe(file);
          onTranscribed(r.text.trim());
        } catch (e: any) {
          setError(e?.response?.data?.message ?? 'No se pudo transcribir el audio.');
        } finally {
          setBusy(false);
        }
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    } catch {
      setError('No se pudo acceder al micrófono.');
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 8, border: '1px dashed #d8dcdd', background: '#fafbfb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {!recording && !busy && (
          <button
            type="button"
            onClick={start}
            style={{ fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 6, background: '#15191a', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            Empezar a grabar
          </button>
        )}
        {recording && (
          <>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: 'oklch(0.5 0.16 25)' }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </span>
            <button
              type="button"
              onClick={stop}
              style={{ fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 6, background: 'oklch(0.5 0.16 25)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Detener y transcribir
            </button>
          </>
        )}
        {busy && <span style={{ fontSize: 12, color: '#6d7577' }}>Transcribiendo…</span>}
      </div>
      {!recording && !busy && (
        <span style={{ fontSize: 11, color: '#6d7577' }}>Dicta la solicitud. Al detener, se transcribe automáticamente.</span>
      )}
      {error && <span role="alert" style={{ fontSize: 12, color: 'oklch(0.5 0.16 25)' }}>{error}</span>}
    </div>
  );
}
