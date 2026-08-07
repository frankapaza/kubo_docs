import axios from 'axios';
import { useId, useRef, useState } from 'react';

import { portalTicketMessagesApi } from '../../../api/ticket-messages.api';
import type { TicketStatus } from '../../../api/types';
import {
  FileDropZone,
  uploadPendingAttachments,
  type PendingAttachment,
  type RejectedAttachment,
} from '../../../components/upload';
import { Button } from '../../../components/ui/Button';
import { STATUS_LABELS } from '../../tickets/ticket-ui';
// Tipo puro, sin nada ejecutable: el reparto «lo que se sabe» / «por qué» vale
// igual en las dos superficies y duplicar la interfaz solo duplicaría el
// razonamiento que su docblock explica. Es lo único que este módulo toma del
// panel.
import type { PostFailure } from '../../tickets/thread/post-failure';

/**
 * Escribir en el hilo desde el **portal del cliente**.
 *
 * **Por qué no es `ThreadComposer` con una bandera.** Aquel compositor es, casi
 * entero, la maquinaria para no equivocarse de destino: dos botones de envío en
 * vez de un selector, el recuadro que se tiñe del color del destino señalado, la
 * frase que nombra a quien va a leerlo y la confirmación de la respuesta
 * pública. Aquí no hay ninguna elección que proteger --un cliente solo puede
 * escribir un mensaje, y el backend fuerza `PUBLICA` para todo actor de cliente
 * pase lo que pase-- así que reutilizarlo sería arrastrar un aparato de
 * seguridad sin el peligro del que protege, y además pedirle a esta pantalla un
 * `visibility` que su API no acepta. Lo que sí se reutiliza es todo lo que no
 * depende del destino: `FileDropZone` (arrastrar, pegar, vistas previas) y
 * `uploadPendingAttachments` (subida en serie, con el motivo de cada rechazo).
 *
 * Un botón, entonces: **Enviar mensaje**.
 */
interface PortalThreadComposerProps {
  ticketId: number;
  /**
   * El estado del ticket **antes** de escribir. Sirve para saber si la respuesta
   * lo movió y poder decirlo con las dos etiquetas.
   */
  ticketStatus: TicketStatus;
  /** Lo llama para que el hilo se recargue. Sus fallos los cuenta el hilo. */
  onPosted: () => void;
  /**
   * El estado que el `POST` devuelve. Se avisa **siempre**, no solo cuando
   * cambia: quien lo recibe decide, y así no hay dos sitios comparando.
   */
  onTicketStatus: (status: TicketStatus) => void;
}

/**
 * Corte local de tiempo, porque la instancia de axios del portal no declara
 * ninguno. Sin él, una petición que no llega a responder nunca deja la pantalla
 * sin salida: el botón se queda en «Enviando…» para siempre y la única
 * escapatoria es recargar, que se lleva por delante el texto escrito.
 *
 * Gemelo del que hay en `ThreadComposer`: allí es una función privada y no se
 * puede compartir sin tocar el panel, que está cerrado.
 */
const POST_TIMEOUT_MS = 20_000;
/** Los adjuntos pueden ser de 10 MB y van de uno en uno: se acota por archivo. */
const UPLOAD_TIMEOUT_MS_PER_FILE = 60_000;

const TIMEOUT_FAILURE: PostFailure = {
  headline: 'El servidor no respondió a tiempo.',
  detail:
    'Tu mensaje puede haberse enviado o no: actualiza la conversación y comprueba si está ' +
    'antes de volver a escribirlo.',
};

export default function PortalThreadComposer({
  ticketId,
  ticketStatus,
  onPosted,
  onTicketStatus,
}: PortalThreadComposerProps) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);

  /** Falló el **envío**. Distinto, y con otras palabras, de un fallo de refresco. */
  const [writeError, setWriteError] = useState<PostFailure | null>(null);
  /** El mensaje sí se envió; alguno de sus archivos, no. */
  const [attachmentIssues, setAttachmentIssues] = useState<RejectedAttachment[]>([]);
  /**
   * El ticket se movió al enviar. Es lo que hace visible la reactivación: el
   * cliente que responde a un ticket en «Espera cliente» lo ve volver a «En
   * atención» sin recargar. Se guarda la transición entera y no un booleano,
   * para poder nombrar los dos extremos y no tener que afirmar cuál fue.
   */
  const [statusChange, setStatusChange] = useState<{ from: TicketStatus; to: TicketStatus } | null>(
    null,
  );

  /**
   * Cambia con cada mensaje enviado y sirve de `key` del `FileDropZone`.
   *
   * La zona de archivos guarda **sus propios** rechazos, que este componente no
   * ve y no puede limpiar; sin esto se quedarían colgando debajo del compositor
   * del mensaje siguiente, hablando de archivos que ya no están en ninguna
   * parte. Cambiar la clave la remonta limpia.
   */
  const [dropZoneEpoch, setDropZoneEpoch] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const domId = useId();

  const trimmedBody = body.trim();
  const ready = trimmedBody.length > 0;

  const send = async () => {
    // Los archivos y el estado de partida se capturan aquí: más abajo la lista
    // se vacía en cuanto el mensaje existe, y `ticketStatus` habrá cambiado ya
    // cuando toque compararlo.
    const pending = files;
    const before = ticketStatus;

    setSending(true);
    // **Todo el estado del compositor se reinicia a la vez.** Limpiar unos
    // avisos y no otros deja en pantalla un cartel del envío anterior junto al
    // resultado del nuevo, y quien lo lee concluye que este también falló y lo
    // manda otra vez -- que aquí son dos mensajes duplicados en el hilo del
    // cliente.
    setWriteError(null);
    setAttachmentIssues([]);
    setStatusChange(null);

    let posted;
    try {
      posted = await withTimeout(
        portalTicketMessagesApi.post(ticketId, { bodyMd: trimmedBody }),
        POST_TIMEOUT_MS,
      );
    } catch (failure) {
      // El fallo se cuenta justo encima del botón, que es donde está mirando
      // quien acaba de pulsarlo.
      setWriteError(describePostError(failure));
      setSending(false);
      return;
    }

    // ------------------------------------------------------------------
    // A partir de aquí el mensaje **existe**. Nada de lo que pase con los
    // adjuntos vuelve a ser un fallo de envío, y los campos se vacían ya:
    // dejarlos llenos durante la subida invita a pulsar otra vez, y eso
    // enviaría un segundo mensaje.
    // ------------------------------------------------------------------
    setBody('');
    setFiles([]);
    setDropZoneEpoch((epoch) => epoch + 1);

    // El estado que manda es el que devuelve el `POST`, no lo que este cliente
    // suponga: el backend condiciona la reactivación al estado que leyó, y
    // puede haber decidido no mover nada.
    onTicketStatus(posted.ticketStatus);
    if (posted.ticketStatus !== before) setStatusChange({ from: before, to: posted.ticketStatus });

    // El hilo se refresca ya, para que el mensaje aparezca aunque los adjuntos
    // tarden. Se vuelve a refrescar al final, cuando ya cuelgan de él.
    onPosted();

    if (pending.length > 0) {
      try {
        const outcome = await withTimeout(
          uploadPendingAttachments(portalTicketMessagesApi, ticketId, posted.message.id, pending),
          UPLOAD_TIMEOUT_MS_PER_FILE * pending.length,
        );
        // Con su código y con el texto del backend tal cual: el tope acumulado
        // de adjuntos del ticket llega **aquí**, después de intentar la subida,
        // y su mensaje es el único que dice cuánto queda y qué hacer.
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

    setSending(false);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <label htmlFor={`${domId}-body`} className="text-[13px] font-semibold text-slate-900">
        Responder
      </label>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Lo que escribas aquí lo lee el equipo de soporte de Kubo.
      </p>

      <textarea
        id={`${domId}-body`}
        ref={textareaRef}
        rows={4}
        value={body}
        disabled={sending}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Cuéntanos qué ha pasado o responde a lo que te hemos preguntado."
        className="mt-3 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-[13px] leading-relaxed text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-60"
      />

      <FileDropZone
        key={dropZoneEpoch}
        className="mt-3"
        files={files}
        onFilesChange={setFiles}
        disabled={sending}
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

      {statusChange && (
        // `role="status"` y no `alert`: es una buena noticia, no una
        // interrupción. Va debajo del botón que la provocó, además del distintivo
        // de la cabecera, que también ha cambiado ya.
        <p
          role="status"
          data-status-change={`${statusChange.from}->${statusChange.to}`}
          className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900"
        >
          Recibimos tu mensaje. El ticket pasó de «{STATUS_LABELS[statusChange.from]}» a «
          {STATUS_LABELS[statusChange.to]}».
        </p>
      )}

      {attachmentIssues.length > 0 && (
        <ul className="mt-3 space-y-1">
          <li className="text-xs font-semibold text-amber-800">
            Tu mensaje sí se envió. Con los archivos pasó esto:
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

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {!ready && (
          <span className="text-[11px] text-slate-500">
            Escribe el mensaje para poder enviarlo: un adjunto no viaja solo.
          </span>
        )}
        <Button type="button" disabled={!ready || sending} onClick={() => void send()}>
          {sending ? 'Enviando…' : 'Enviar mensaje'}
        </Button>
      </div>
    </div>
  );
}

/**
 * La misma promesa, pero que se rinde al cabo de un rato.
 *
 * No cancela la petición --no hay forma de hacerlo sin tocar la instancia de
 * axios compartida del portal--, así que el mensaje que se enseña **no afirma
 * que no se haya enviado**: con una respuesta que no llega, eso no se sabe.
 * Decir «no se envió» sería la forma más directa de provocar el duplicado.
 */
class TimeoutError extends Error {
  constructor() {
    super(`${TIMEOUT_FAILURE.headline} ${TIMEOUT_FAILURE.detail}`);
    this.name = 'TimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const alarm = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  // `finally` y no `then`: el temporizador se apaga tanto si la petición sale
  // bien como si falla, y sin él queda un `setTimeout` vivo por cada envío.
  return Promise.race([promise, alarm]).finally(() => clearTimeout(timer));
}

/**
 * El fallo de **enviar** el mensaje, en español y con el texto del backend
 * cuando lo hay --sus mensajes ya están redactados para leerse («Un ticket
 * cerrado no admite mensajes nuevos.») y reescribirlos aquí sería mantener dos
 * versiones del mismo rechazo.
 *
 * No se reutiliza `describeAttachmentError`: su texto de reserva habla de «la
 * operación con el archivo», y aquí puede no haber ningún archivo por medio.
 */
function describePostError(error: unknown): PostFailure {
  // El único caso en el que **no** se puede afirmar que no se envió nada.
  if (error instanceof TimeoutError) return TIMEOUT_FAILURE;

  const headline = 'No se envió tu mensaje.';

  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return {
        headline,
        detail: 'No se pudo contactar con el servidor. Comprueba tu conexión e inténtalo de nuevo.',
      };
    }
    const body: unknown = error.response.data;
    if (
      body &&
      typeof body === 'object' &&
      typeof (body as { message?: unknown }).message === 'string'
    ) {
      return { headline, detail: (body as { message: string }).message };
    }
  }
  return { headline, detail: 'No se pudo enviar el mensaje. Inténtalo de nuevo.' };
}
