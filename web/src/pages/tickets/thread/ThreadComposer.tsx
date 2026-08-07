import axios from 'axios';
import { useId, useRef, useState } from 'react';

import { ticketMessagesApi } from '../../../api/ticket-messages.api';
import type { TicketMessageVisibility } from '../../../api/types';
import { TimeoutError, withTimeout } from '../../../lib/with-timeout';
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
import type { PostFailure } from './post-failure';
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

/**
 * Cortes locales de tiempo, porque la instancia de axios del proyecto no
 * declara ninguno.
 *
 * Sin ellos, una petición que no llega a responder nunca no deja «el botón
 * muerto»: deja **el diálogo convertido en una trampa**. Con el envío colgado,
 * Cancelar está deshabilitado, Escape se ignora y el clic en el fondo también,
 * porque las tres cosas se bloquean a propósito mientras hay algo de camino.
 * Sin salida, la única escapatoria es recargar la página, y recargando se
 * pierde el texto escrito.
 *
 * Que la instancia sea compartida no impide acotar **aquí**: se acota la espera
 * de esta pantalla, no la de nadie más.
 */
const POST_TIMEOUT_MS = 20_000;
/** Los adjuntos pueden ser de 10 MB y van de uno en uno: se acota por archivo. */
const UPLOAD_TIMEOUT_MS_PER_FILE = 60_000;

const TIMEOUT_FAILURE: PostFailure = {
  headline: 'El servidor no respondió a tiempo.',
  detail:
    'El mensaje puede haberse publicado o no: actualiza la conversación y comprueba si está ' +
    'antes de volver a enviarlo.',
};

export default function ThreadComposer({ ticketId, clientName, onPosted }: ThreadComposerProps) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<PendingAttachment[]>([]);

  /** El destino señalado con el cursor o el foco. `null` = ninguno todavía. */
  const [aimed, setAimed] = useState<TicketMessageVisibility | null>(null);
  /** El destino en vuelo, si lo hay. Mantiene el tinte mientras se envía. */
  const [sending, setSending] = useState<TicketMessageVisibility | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);

  /** Falló la **escritura**. Distinto, y con otras palabras, de un fallo de refresco. */
  const [writeError, setWriteError] = useState<PostFailure | null>(null);
  /** El mismo fallo, cuando ocurre con el diálogo delante: se cuenta ahí dentro. */
  const [dialogError, setDialogError] = useState<PostFailure | null>(null);
  /** El mensaje sí se publicó; alguno de sus archivos, no. */
  const [attachmentIssues, setAttachmentIssues] = useState<RejectedAttachment[]>([]);

  /**
   * Cambia en cada mensaje publicado y sirve de `key` del `FileDropZone`.
   *
   * La zona de archivos guarda **sus propios** rechazos («no es de un tipo
   * permitido…»), que este componente no ve y no puede limpiar. Sin esto, los
   * rechazos del mensaje anterior se quedaban colgando debajo del compositor
   * del siguiente, hablando de archivos que ya no están en ninguna parte.
   * Cambiar la clave la remonta limpia; los archivos aceptados son estado de
   * aquí y se vacían aparte.
   */
  const [dropZoneEpoch, setDropZoneEpoch] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const domId = useId();

  const busy = sending !== null;
  /** El cuerpo tal y como va a viajar: lo mismo que se envía y lo que se previsualiza. */
  const trimmedBody = body.trim();
  const ready = trimmedBody.length > 0;
  // Qué destino se está enseñando, por orden de mando: el envío en curso, la
  // confirmación abierta, y por último lo que se esté señalando con el cursor o
  // el foco. Los dos primeros hacen falta porque al pulsar el botón el cursor
  // deja de estar encima --y sin ellos el recuadro volvería a neutro justo en
  // el momento en el que el destino ya está decidido, que es cuando más importa
  // que se vea.
  const shown = sending ?? (confirmOpen ? 'PUBLICA' : aimed);
  const skin = shown ? VISIBILITY_SKINS[shown] : null;

  const send = async (visibility: TicketMessageVisibility) => {
    // Los archivos se capturan aquí: más abajo se vacía la lista en cuanto el
    // mensaje existe, y la subida sigue necesitándolos.
    const pending = files;

    setSending(visibility);
    setWriteError(null);
    setDialogError(null);
    setAttachmentIssues([]);

    let posted;
    try {
      posted = await withTimeout(
        ticketMessagesApi.post(ticketId, { bodyMd: trimmedBody, visibility }),
        POST_TIMEOUT_MS,
      );
    } catch (failure) {
      // El error va donde el usuario está mirando. La respuesta pública se
      // manda siempre desde el diálogo, y el diálogo tapa el compositor:
      // escribir ahí detrás es dejar el fallo fuera de la vista, con el botón
      // de confirmar rehabilitado y sin una palabra --justo el reflejo de doble
      // clic que la confirmación existe para evitar.
      const described = describePostError(failure);
      if (visibility === 'PUBLICA') setDialogError(described);
      else setWriteError(described);
      setSending(null);
      return;
    }

    // ------------------------------------------------------------------
    // A partir de aquí el mensaje **existe**. Nada de lo que pase con los
    // adjuntos vuelve a ser un fallo de escritura, y los campos se vacían ya:
    // dejarlos llenos durante la subida invita a pulsar otra vez, y eso
    // publicaría un segundo mensaje.
    // ------------------------------------------------------------------
    setConfirmOpen(false);
    setBody('');
    setFiles([]);
    setDropZoneEpoch((epoch) => epoch + 1);

    // **Imprescindible, y por poco no estaba.** Al vaciarse el cuerpo, los dos
    // botones pasan a deshabilitados, y un botón deshabilitado **no emite
    // `mouseleave`**: si el puntero sigue encima, `aimed` se queda clavado en el
    // destino del mensaje que se acaba de mandar. El resultado era que, tras
    // guardar una nota interna, el recuadro seguía ámbar afirmando «solo lo lee
    // el equipo… no se envía ningún correo» **mientras se escribía el mensaje
    // siguiente**, que puede ir a otro sitio. No desvía el envío --eso lo decide
    // el botón que se pulsa-- pero invierte la señal sobre la que se apoya todo
    // lo demás, que es peor.
    setAimed(null);

    // El hilo se refresca ya, para que el mensaje aparezca aunque los adjuntos
    // tarden. Se vuelve a refrescar al final, cuando ya cuelgan de él.
    onPosted();

    if (pending.length > 0) {
      try {
        const outcome = await withTimeout(
          uploadPendingAttachments(ticketMessagesApi, ticketId, posted.message.id, pending),
          UPLOAD_TIMEOUT_MS_PER_FILE * pending.length,
        );
        setAttachmentIssues([...outcome.failed, ...outcome.skipped]);
      } catch {
        // `uploadPendingAttachments` no rechaza por su cuenta --cuenta cada
        // rechazo dentro de su resultado--, así que caer aquí solo puede ser el
        // corte de tiempo. Se cuenta archivo por archivo y sin afirmar que no
        // subieron: no se sabe cuáles llegaron.
        setAttachmentIssues(
          pending.map((item) => ({
            id: item.id,
            filename: item.file.name,
            code: 'TIMEOUT',
            message:
              `«${item.file.name}»: el servidor no respondió a tiempo. ` +
              'Puede haberse adjuntado o no; actualiza la conversación para comprobarlo.',
          })),
        );
      }
      onPosted();
    }

    setSending(null);
  };

  // Se anota siempre, también durante el envío: mientras dura, `shown` hace
  // caso a `sending` de todas formas, y al terminar `aimed` refleja dónde está
  // de verdad el cursor.
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
        key={dropZoneEpoch}
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
          <strong className="font-semibold">{writeError.headline}</strong> {writeError.detail}
        </p>
      )}

      {attachmentIssues.length > 0 && (
        <ul className="mt-3 space-y-1">
          <li className="text-xs font-semibold text-amber-800">
            El mensaje sí se publicó. Con los archivos pasó esto:
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
        {destinationButton('PUBLICA', () => {
          setDialogError(null);
          setConfirmOpen(true);
        })}
        {destinationButton('INTERNA', () => void send('INTERNA'))}
      </div>

      {!ready && (
        <p className="mt-2 text-center text-[11px] text-slate-500">
          Escribe el mensaje para poder enviarlo: un adjunto no viaja solo.
        </p>
      )}

      <PublicReplyDialog
        open={confirmOpen}
        // El cuerpo **recortado**: es el que se envía, así que es el que hay que
        // enseñar. Previsualizar el sin recortar convertía «esto es lo que se
        // publica» en una frase que no era exacta.
        bodyMd={trimmedBody}
        attachmentCount={files.length}
        clientName={clientName}
        submitting={sending === 'PUBLICA'}
        error={dialogError}
        onCancel={() => {
          setConfirmOpen(false);
          setDialogError(null);
        }}
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
function describePostError(error: unknown): PostFailure {
  // El único caso en el que **no** se puede afirmar que no se publicó nada.
  if (error instanceof TimeoutError) return TIMEOUT_FAILURE;

  const headline = 'No se publicó nada.';

  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return {
        headline,
        detail: 'No se pudo contactar con el servidor. Comprueba tu conexión e inténtalo de nuevo.',
      };
    }
    const body: unknown = error.response.data;
    if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') {
      return { headline, detail: (body as { message: string }).message };
    }
  }
  return { headline, detail: 'No se pudo publicar el mensaje. Inténtalo de nuevo.' };
}
