import { useEffect, useRef, useState } from 'react';

import {
  portalApi,
  PORTAL_TICKET_SUBJECT_MAX_LENGTH,
  PORTAL_TICKET_DESCRIPTION_MAX_LENGTH,
} from '../../api/portal.api';
import { portalTicketMessagesApi } from '../../api/ticket-messages.api';
import type { PortalClientSystem, PortalCreatedTicket, PortalTicket } from '../../api/types';
import { Button } from '../../components/ui/Button';
import {
  FileDropZone,
  uploadPendingAttachments,
  type PendingAttachment,
  type RejectedAttachment,
} from '../../components/upload';
import { withTimeout } from '../../lib/with-timeout';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreated: (ticket: PortalTicket) => void;
}

/**
 * Los adjuntos pueden ser de 10 MB y van de uno en uno: se acota por archivo,
 * igual que en los compositores del hilo.
 */
const UPLOAD_TIMEOUT_MS_PER_FILE = 60_000;

/**
 * Cuerpo de error de la API: `{ code, message }`, y en los 400 de validación
 * también `details` con un motivo por entrada. `message` es siempre una cadena
 * ya legible — el filtro del backend une la lista— así que `details` solo se
 * usa para poder desglosarla en viñetas.
 */
function toErrorList(e: any): string[] {
  const data = e?.response?.data as { message?: string; details?: unknown } | undefined;

  if (Array.isArray(data?.details) && data.details.length > 0) {
    return data.details.map(String);
  }
  if (typeof data?.message === 'string' && data.message.length > 0) {
    return [data.message];
  }
  return ['No se pudo crear el ticket. Inténtalo de nuevo.'];
}

export default function NewPortalTicketDialog({ open, onCancel, onCreated }: Props) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [systemId, setSystemId] = useState<number | ''>('');
  const [systems, setSystems] = useState<PortalClientSystem[]>([]);
  const [files, setFiles] = useState<PendingAttachment[]>([]);

  const [busy, setBusy] = useState(false);
  // Lista y no cadena: un 400 de validación puede traer varios motivos a la
  // vez. El backend manda `message` ya legible y `details` con la lista
  // desglosada; aquí se pinta una viñeta por motivo cuando hay más de uno.
  const [errors, setErrors] = useState<string[]>([]);

  /**
   * El ticket **ya creado** cuyo diálogo se retiene para contar qué pasó con
   * sus archivos.
   *
   * Sin esto, un adjunto que no subió se perdía por el desagüe: el alta cierra
   * el diálogo, y con él se iría el único sitio donde ese fallo se podía contar.
   * El cliente se quedaría convencido de haber mandado la captura que el técnico
   * necesita. Mientras hay algo aquí, el ticket existe y no se vuelve a crear.
   */
  const [createdTicket, setCreatedTicket] = useState<PortalCreatedTicket | null>(null);
  const [attachmentIssues, setAttachmentIssues] = useState<RejectedAttachment[]>([]);

  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Cambia en cada alta y sirve de `key` del `FileDropZone`: la zona guarda sus
   * propios rechazos («no es de un tipo permitido…»), que este componente no ve
   * y no puede limpiar. Mismo motivo que en `ThreadComposer`.
   */
  const [dropZoneEpoch, setDropZoneEpoch] = useState(0);

  /**
   * Corta el camino tardío tras desmontar. Entre el alta y el final de la subida
   * pueden pasar minutos --el corte de tiempo es de 60 s por archivo-- y en ese
   * rato el portal puede navegar a otra pantalla.
   */
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
   * El doble clic corriente ya lo cubre `disabled`: el clic es un evento
   * discreto, así que React 18 vacía el estado antes de despachar el segundo y
   * el botón ya está deshabilitado. **No hay un duplicado demostrado**; esto no
   * arregla un fallo observado.
   *
   * Se queda porque es una línea y porque lo que protege no se deshace: un alta
   * del portal escribe un ticket y manda dos correos, y un correo no se retira.
   * Que hoy no haya hueco depende de cómo React agrupe y despache los eventos
   * --de la versión, del modo y de que el manejador siga siendo discreto--, y
   * eso es una garantía prestada. Un `ref` se escribe y se lee en el mismo tick
   * y no depende de nada de eso. Misma guarda que los dos compositores del hilo.
   */
  const inFlight = useRef(false);

  // Resetea el formulario cada vez que el diálogo se abre; se mantiene
  // montado (mismo patrón que NewTicketDialog del panel interno) para no
  // perder el listener de Escape entre aperturas.
  useEffect(() => {
    if (!open) return;
    setSubject('');
    setDescription('');
    setSystemId('');
    setErrors([]);
    setFiles([]);
    setCreatedTicket(null);
    setAttachmentIssues([]);
    setDropZoneEpoch((epoch) => epoch + 1);
  }, [open]);

  // `listSystems` solo devuelve los sistemas activos del cliente y es
  // opcional para el alta: si falla, el select queda vacío pero el usuario
  // puede seguir creando el ticket sin sistema. No es una escritura, así que
  // el fallo se registra en consola y no bloquea el formulario — a
  // diferencia del fallo de `submit`, que sí debe ver el usuario.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    portalApi
      .listSystems()
      .then((list) => {
        if (!cancelled) setSystems(list);
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('[NewPortalTicketDialog] No se pudo cargar la lista de sistemas.', e);
          setSystems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  /**
   * Cerrar el diálogo por Escape o por el fondo.
   *
   * Tres casos, y los tres importan:
   *
   * - **Con algo en vuelo, no se cierra.** Cerrar durante la subida se llevaría
   *   por delante el único sitio donde se cuenta qué archivo no llegó.
   * - **Con el ticket ya creado**, cerrar es *seguir* hasta él, no cancelar: el
   *   ticket existe, y salir por `onCancel` dejaría la lista del portal sin
   *   enterarse de que hay uno nuevo.
   * - En cualquier otro momento, cancelar de toda la vida.
   */
  const dismiss = () => {
    if (busy) return;
    if (createdTicket) {
      onCreated(createdTicket);
      return;
    }
    onCancel();
  };

  // Cerrar con Escape — mismo idioma que los diálogos del panel interno.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // Las dependencias son las que `dismiss` mira: sin `busy` ni
    // `createdTicket`, el oyente se quedaría con la decisión que era correcta
    // cuando se montó y cerraría el diálogo en mitad de una subida.
  }, [open, busy, createdTicket, onCancel, onCreated]);

  if (!open) return null;

  const canSubmit = subject.trim().length > 0 && description.trim().length > 0;

  const submit = async () => {
    // La guarda, antes que nada y sin ningún `await` por delante: entre esta
    // línea y la siguiente no puede colarse otro clic.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await create();
    } finally {
      // En el `finally` para que un fallo no deje el diálogo bloqueado para
      // siempre: el cliente tiene que poder reintentar.
      inFlight.current = false;
    }
  };

  const create = async () => {
    if (!canSubmit) {
      setErrors(['El asunto y la descripción son obligatorios.']);
      return;
    }

    // Los archivos se capturan aquí: más abajo se vacía la lista en cuanto el
    // ticket existe, y la subida sigue necesitándolos.
    const pending = files;

    setBusy(true);
    setErrors([]);
    setAttachmentIssues([]);

    let created: PortalCreatedTicket;
    try {
      created = await portalApi.createTicket({
        subject: subject.trim(),
        description: description.trim(),
        systemId: systemId || undefined,
      });
    } catch (e: any) {
      // Fallo de escritura: el ticket NO se creó. Se muestra en el propio
      // diálogo (no en consola) para que quede claro que hay que reintentar,
      // a diferencia del fallo silencioso de `listSystems` de arriba.
      if (alive.current) {
        setErrors(toErrorList(e));
        setBusy(false);
      }
      return;
    }

    if (!alive.current) return;

    // ------------------------------------------------------------------
    // A partir de aquí el ticket **existe**, y eso no se deshace. Nada de lo
    // que pase con los adjuntos vuelve a ser un fallo de alta: si algo falla,
    // se cuenta como lo que es -- el ticket está abierto, este archivo no
    // llegó -- y nunca como «no se pudo crear el ticket», que mandaría al
    // cliente a crearlo otra vez.
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
        // Contra el primer mensaje del hilo, que el alta acaba de escribir: es
        // lo que le da a cada archivo una visibilidad de la que heredar.
        uploadPendingAttachments(
          portalTicketMessagesApi,
          created.id,
          created.firstMessageId,
          pending,
        ),
        UPLOAD_TIMEOUT_MS_PER_FILE * pending.length,
      );
      issues = [...outcome.failed, ...outcome.skipped];
    } catch {
      // `uploadPendingAttachments` no rechaza por su cuenta --cuenta cada
      // rechazo dentro de su resultado--, así que caer aquí solo puede ser el
      // corte de tiempo. Se cuenta archivo por archivo y sin afirmar que no
      // subieron: no se sabe cuáles llegaron.
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

    // Sin incidencias no se entretiene a nadie: el ticket se abre y ya está.
    if (issues.length === 0) {
      onCreated(created);
      return;
    }

    // Con incidencias, el diálogo se queda para contarlas. `createdTicket`
    // guarda el ticket ya creado para poder seguir hasta él sin volver a
    // crearlo.
    setAttachmentIssues(issues);
    setCreatedTicket(created);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-portal-ticket-title"
      onClick={dismiss}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      style={{ paddingTop: '6vh' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-pop"
      >
        <h2 id="new-portal-ticket-title" className="text-lg font-semibold text-slate-900">
          Nuevo ticket
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Cuéntanos qué necesitas; nuestro equipo lo revisará y te dará seguimiento.
        </p>

        {errors.length > 0 && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errors.length === 1 ? (
              errors[0]
            ) : (
              <ul className="list-disc space-y-1 pl-5">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-4 space-y-4">
          <div>
            <label className="label" htmlFor="portal-ticket-subject">
              Asunto *
            </label>
            <input
              id="portal-ticket-subject"
              className="input"
              type="text"
              value={subject}
              maxLength={PORTAL_TICKET_SUBJECT_MAX_LENGTH}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Resumen breve de tu solicitud"
            />
          </div>

          <div>
            <label className="label" htmlFor="portal-ticket-description">
              Descripción *
            </label>
            <textarea
              id="portal-ticket-description"
              ref={descriptionRef}
              className="input"
              rows={5}
              value={description}
              maxLength={PORTAL_TICKET_DESCRIPTION_MAX_LENGTH}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe el problema o la solicitud con el mayor detalle posible"
            />
          </div>

          <div>
            <span className="label">Archivos adjuntos (opcional)</span>
            <FileDropZone
              key={dropZoneEpoch}
              files={files}
              onFilesChange={setFiles}
              disabled={busy || createdTicket !== null}
              // El Ctrl+V se acepta también con el cursor en la descripción,
              // que es donde está cuando se pega una captura.
              pasteScope={descriptionRef}
              hint={
                <p className="mt-0.5 text-xs text-slate-500">
                  Una captura de la pantalla o del error nos ahorra media
                  conversación.
                </p>
              }
            />
          </div>

          <div>
            <label className="label" htmlFor="portal-ticket-system">
              Sistema (opcional)
            </label>
            <select
              id="portal-ticket-system"
              className="input"
              value={systemId}
              onChange={(e) => setSystemId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">(sin sistema)</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/*
          El ticket ya está creado: lo único que queda por contar es qué pasó
          con los archivos. El titular lo dice primero y sin rodeos, porque lo
          que no puede pasar es que el cliente lea esto como «no se creó» y
          vuelva a abrir el mismo ticket.
        */}
        {attachmentIssues.length > 0 && (
          <ul className="mt-4 space-y-1">
            <li className="text-sm font-semibold text-amber-800">
              Tu ticket se creó. Con los archivos pasó esto:
            </li>
            {attachmentIssues.map((issue) => (
              <li
                key={issue.id}
                role="alert"
                data-error-code={issue.code}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                {issue.message}
              </li>
            ))}
            <li className="text-xs text-slate-500">
              Puedes adjuntarlos desde la conversación del ticket.
            </li>
          </ul>
        )}

        <div className="mt-6 flex justify-end gap-2">
          {createdTicket ? (
            <Button type="button" variant="primary" onClick={() => onCreated(createdTicket)}>
              Ver el ticket
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={submit}
                disabled={busy || !canSubmit}
                loading={busy}
              >
                {busy ? 'Creando…' : 'Crear ticket'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
