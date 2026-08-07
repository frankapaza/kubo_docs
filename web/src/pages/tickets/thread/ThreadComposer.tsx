import axios from 'axios';
import { useId, useRef, useState } from 'react';

import { ticketMessagesApi } from '../../../api/ticket-messages.api';
import type { TicketMessageVisibility } from '../../../api/types';
import {
  FileDropZone,
  uploadPendingAttachments,
  type PendingAttachment,
  type RejectedAttachment,
} from '../../../components/upload';
import {
  audienceSentence,
  consequenceLine,
  NO_DESTINATION_NOTICE,
  VISIBILITY_SKINS,
} from './message-visibility';
import PublicReplyDialog from './PublicReplyDialog';

/**
 * Escribir en el hilo. Es la pieza donde se juega la tarea entera, así que la
 * decisión de diseño va escrita aquí y no en un ticket que nadie relea.
 *
 * **El fallo que hay que hacer imposible** es escribir «este cliente no paga
 * desde marzo» creyendo que es una nota interna y que salga por correo. El
 * backend no puede evitarlo: hace exactamente lo que se le pide. Se evita aquí,
 * con cuatro cosas que se refuerzan entre sí:
 *
 * 1. **Dos botones de envío, no un selector.** Un desplegable (o un par de
 *    radios que recuerdan la elección) tiene el fallo de quedarse en el valor
 *    anterior: se elige una vez, se olvida, y el décimo mensaje sale con el
 *    destino del noveno. Aquí no hay ningún estado que recordar entre mensajes:
 *    el destino **es** el botón que se pulsa, cada vez, y los dos son visibles
 *    a la vez con su color y su consecuencia escrita debajo.
 * 2. **El compositor se tiñe antes de pulsar.** Al poner el cursor encima o el
 *    foco en cualquiera de los dos botones, el recuadro entero toma el color de
 *    ese destino y el aviso de arriba cambia a la frase que dice **quién lo va
 *    a leer**, con el nombre de la empresa. Mientras no haya ninguno señalado,
 *    el aviso dice que el mensaje todavía no tiene destino: no hay un estado
 *    «por omisión» que se pueda confundir con una elección.
 * 3. **La respuesta pública pasa por una confirmación** que enseña el texto ya
 *    vestido de respuesta y nombra al destinatario. La nota interna no pasa por
 *    nada: fricción solo donde no hay marcha atrás (ver `PublicReplyDialog`).
 * 4. **Los mismos colores que el hilo.** El ámbar del compositor es el ámbar de
 *    la nota interna en la lista de arriba, y el índigo el de la respuesta.
 *    Todos salen de `VISIBILITY_SKINS`.
 *
 * Lo que **no** se hace: acordarse del último destino usado, ni preseleccionar
 * el «más común». Las dos cosas son la misma trampa del desplegable con otro
 * nombre.
 */
interface ThreadComposerProps {
  ticketId: number;
  /** Razón social, para poder nombrar a quien va a leer la respuesta. */
  clientName: string | null;
  /** Lo llama el hilo para recargarse. Sus fallos los cuenta el hilo, no esto. */
  onPosted: () => void;
}

export default function ThreadComposer({ ticketId, clientName, onPosted }: ThreadComposerProps) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<PendingAttachment[]>([]);

  /** El destino señalado con el cursor o el foco. `null` = ninguno todavía. */
  const [aimed, setAimed] = useState<TicketMessageVisibility | null>(null);
  /** El destino en vuelo, si lo hay. Mantiene el tinte mientras se envía. */
  const [sending, setSending] = useState<TicketMessageVisibility | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);

  /** Falló la **escritura**: no se publicó nada. Distinto de un fallo de refresco. */
  const [writeError, setWriteError] = useState<string | null>(null);
  /** El mensaje sí se publicó; alguno de sus archivos, no. */
  const [attachmentIssues, setAttachmentIssues] = useState<RejectedAttachment[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const domId = useId();

  const busy = sending !== null;
  const ready = body.trim().length > 0;
  // Qué destino se está enseñando, por orden de mando: el envío en curso, la
  // confirmación abierta, y por último lo que se esté señalando con el cursor o
  // el foco. Los dos primeros hacen falta porque al pulsar el botón el cursor
  // deja de estar encima --y sin ellos el recuadro volvería a neutro justo en
  // el momento en el que el destino ya está decidido, que es cuando más importa
  // que se vea.
  const shown = sending ?? (confirmOpen ? 'PUBLICA' : aimed);
  const skin = shown ? VISIBILITY_SKINS[shown] : null;

  const send = async (visibility: TicketMessageVisibility) => {
    setSending(visibility);
    setWriteError(null);
    setAttachmentIssues([]);

    try {
      const posted = await ticketMessagesApi.post(ticketId, {
        bodyMd: body.trim(),
        visibility,
      });

      // Los adjuntos van después: su URL lleva el id del mensaje, que no existe
      // hasta aquí. `uploadPendingAttachments` los sube de uno en uno y cuenta
      // cada rechazo con su nombre y su motivo.
      let issues: RejectedAttachment[] = [];
      if (files.length > 0) {
        const outcome = await uploadPendingAttachments(
          ticketMessagesApi,
          ticketId,
          posted.message.id,
          files,
        );
        issues = [...outcome.failed, ...outcome.skipped];
      }

      // Se limpia aunque algún archivo haya fallado: el mensaje **ya está
      // publicado**, así que dejar los archivos en la zona invitaría a pulsar
      // otra vez y eso publicaría un segundo mensaje. Los fallos quedan escritos
      // debajo, con el nombre de cada archivo, para poder volver a adjuntarlos
      // en un mensaje nuevo a sabiendas.
      setBody('');
      setFiles([]);
      setConfirmOpen(false);
      setAttachmentIssues(issues);
      onPosted();
    } catch (failure) {
      setWriteError(describePostError(failure));
    } finally {
      setSending(null);
    }
  };

  // Se anota siempre, también durante el envío: mientras dura, `shown` hace
  // caso a `sending` de todas formas, y al terminar `aimed` refleja dónde está
  // de verdad el cursor. Ignorar el `mouseleave` mientras hay una petición en
  // vuelo dejaba el recuadro teñido de un destino del que el usuario ya se
  // había apartado.
  const aim = (visibility: TicketMessageVisibility | null) => () => setAimed(visibility);

  const destinationButton = (visibility: TicketMessageVisibility, onClick: () => void) => {
    const it = VISIBILITY_SKINS[visibility];
    const helpId = `${domId}-${visibility}`;
    return (
      <div className="flex-1">
        <button
          type="button"
          disabled={!ready || busy}
          onClick={onClick}
          onMouseEnter={aim(visibility)}
          onMouseLeave={aim(null)}
          onFocus={aim(visibility)}
          onBlur={aim(null)}
          aria-describedby={helpId}
          className={
            'inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold ' +
            'transition focus:outline-none focus:ring-2 focus:ring-offset-2 ' +
            `disabled:cursor-not-allowed disabled:opacity-40 ${it.buttonClass}`
          }
        >
          {sending === visibility ? 'Enviando…' : it.action}
        </button>
        <p id={helpId} className="mt-1 text-center text-[11px] text-slate-500">
          {consequenceLine(visibility)}
        </p>
      </div>
    );
  };

  return (
    <div
      data-aimed-at={shown ?? 'ninguno'}
      className={`rounded-xl border-2 p-4 transition-colors ${
        skin ? skin.composerClass : 'border-slate-200 bg-white'
      }`}
    >
      <p
        aria-live="polite"
        className={`rounded-lg px-3 py-2 text-[13px] font-medium ${
          skin ? skin.noticeClass : 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-300'
        }`}
      >
        {shown ? audienceSentence(shown, clientName) : NO_DESTINATION_NOTICE}
      </p>

      <label htmlFor={`${domId}-body`} className="sr-only">
        Mensaje
      </label>
      <textarea
        id={`${domId}-body`}
        ref={textareaRef}
        rows={4}
        value={body}
        disabled={busy}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Escribe el mensaje. Después elige con qué botón lo mandas."
        className="mt-3 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-[13px] leading-relaxed text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-60"
      />

      <FileDropZone
        className="mt-3"
        files={files}
        onFilesChange={setFiles}
        disabled={busy}
        // El Ctrl+V se acepta también con el cursor en el texto, que es donde
        // está cuando se pega una captura.
        pasteScope={textareaRef}
      />

      {writeError && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-800"
        >
          <strong className="font-semibold">No se publicó nada.</strong> {writeError}
        </p>
      )}

      {attachmentIssues.length > 0 && (
        <ul className="mt-3 space-y-1">
          <li className="text-xs font-semibold text-amber-800">
            El mensaje sí se publicó, pero estos archivos no se pudieron adjuntar:
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
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        {destinationButton('PUBLICA', () => setConfirmOpen(true))}
        {destinationButton('INTERNA', () => void send('INTERNA'))}
      </div>

      {!ready && (
        <p className="mt-2 text-center text-[11px] text-slate-500">
          Escribe el mensaje para poder enviarlo: un adjunto no viaja solo.
        </p>
      )}

      <PublicReplyDialog
        open={confirmOpen}
        bodyMd={body}
        attachmentCount={files.length}
        clientName={clientName}
        submitting={sending === 'PUBLICA'}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void send('PUBLICA')}
      />
    </div>
  );
}

/**
 * El fallo de **escribir** el mensaje, en español.
 *
 * No se reutiliza `describeAttachmentError`: su texto de reserva habla de «la
 * operación con el archivo», y aquí puede no haber ningún archivo por medio --
 * un ticket cerrado (409) o un cuerpo vacío (400) no tienen nada que ver con
 * los adjuntos, y leer que falló «el archivo» mandaría a buscar el problema
 * donde no está.
 */
function describePostError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return 'No se pudo contactar con el servidor. Comprueba tu conexión e inténtalo de nuevo.';
    }
    const body: unknown = error.response.data;
    if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') {
      return (body as { message: string }).message;
    }
  }
  return 'No se pudo publicar el mensaje. Inténtalo de nuevo.';
}
