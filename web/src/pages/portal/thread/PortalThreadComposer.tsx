import axios from 'axios';
import { useEffect, useId, useRef, useState } from 'react';

import { portalTicketMessagesApi } from '../../../api/ticket-messages.api';
import type { TicketStatus } from '../../../api/types';
import {
  FileDropZone,
  uploadPendingAttachments,
  type PendingAttachment,
  type RejectedAttachment,
} from '../../../components/upload';
import { Button } from '../../../components/ui/Button';
import { TimeoutError, withTimeout } from '../../../lib/with-timeout';
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
 * Cuánto se espera antes de rendirse. El mecanismo es compartido
 * (`lib/with-timeout.ts`); lo que se decide aquí son los plazos y **el texto**,
 * que es lo único que de verdad cambia entre las dos superficies: quien lee
 * este es un cliente, no un técnico.
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
   * El estado en el que queda el ticket, cuando resulta ser otro del que esta
   * pantalla tenía. Es lo que hace visible la reactivación: el cliente que
   * responde a un ticket en «Espera cliente» lo ve en «En atención» sin
   * recargar.
   *
   * **Se guarda solo el estado resultante, y el aviso solo nombra ese.** Nombrar
   * también el de partida --«pasó de X a Y»-- parecía más informativo y era una
   * afirmación que este componente no puede sostener: el de partida sale del
   * estado local, que la ficha carga una vez al abrirse y no vuelve a refrescar.
   * Basta con que el técnico mueva el ticket desde el panel mientras la pestaña
   * está abierta para que ese origen sea falso: el backend leería «En atención»
   * dentro de su transacción, **no reactivaría nada**, devolvería «En atención»
   * y aquí se le atribuiría al mensaje del cliente una transición que no
   * ocurrió. El `POST` no devuelve el estado previo, así que lo honesto es decir
   * dónde está el ticket y no de dónde viene ni por qué.
   */
  const [resultingStatus, setResultingStatus] = useState<TicketStatus | null>(null);

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

  /**
   * Corta el camino tardío tras desmontar, igual que `PortalTicketThread` y
   * `PortalThreadAttachment`. Entre el `POST` y el final de la subida de
   * adjuntos pueden pasar minutos --60 s de corte por archivo--, y en ese rato
   * basta con que el cliente vuelva a «Mis tickets».
   */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Guarda **síncrona** contra el doble envío, la misma que `ThreadComposer`.
   *
   * `disabled={sending}` no basta: `sending` es estado de React y no cambia
   * hasta el siguiente render, así que dos clics dentro del mismo tick entran
   * los dos. Aquí no salen dos correos a un cliente --el peligro que hay en el
   * panel-- pero sí dos mensajes idénticos en el hilo y dos avisos al buzón del
   * equipo. Va también aquí porque la asimetría es justo lo que deja a la
   * siguiente revisión sin saber si la ausencia era decisión o descuido.
   */
  const inFlight = useRef(false);

  const trimmedBody = body.trim();
  const ready = trimmedBody.length > 0;

  const send = async () => {
    // Antes de cualquier `await`: entre esta línea y la siguiente no puede
    // colarse otro clic.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await post();
    } finally {
      // En el `finally` para que un fallo no deje el compositor bloqueado para
      // siempre: el cliente tiene que poder reintentar.
      inFlight.current = false;
    }
  };

  const post = async () => {
    // Los archivos y el estado que esta pantalla tenía se capturan aquí: más
    // abajo la lista se vacía en cuanto el mensaje existe, y `ticketStatus`
    // habrá cambiado ya cuando toque compararlo.
    const pending = files;
    const shownBefore = ticketStatus;

    setSending(true);
    // **Todo el estado del compositor se reinicia a la vez.** Limpiar unos
    // avisos y no otros deja en pantalla un cartel del envío anterior junto al
    // resultado del nuevo, y quien lo lee concluye que este también falló y lo
    // manda otra vez -- que aquí son dos mensajes duplicados en el hilo del
    // cliente.
    setWriteError(null);
    setAttachmentIssues([]);
    setResultingStatus(null);

    let posted;
    try {
      posted = await withTimeout(
        portalTicketMessagesApi.post(ticketId, { bodyMd: trimmedBody }),
        POST_TIMEOUT_MS,
      );
    } catch (failure) {
      if (!alive.current) return;
      // El fallo se cuenta justo encima del botón, que es donde está mirando
      // quien acaba de pulsarlo.
      setWriteError(describePostError(failure));
      setSending(false);
      return;
    }

    // El mensaje ya está enviado --eso no se deshace-- pero si el cliente se
    // fue de la ficha, aquí no queda nadie a quien contárselo.
    if (!alive.current) return;

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
    // La comparación es solo para decidir **si hay algo que decir**: si el
    // distintivo de arriba ya enseñaba ese estado, un aviso no añadiría nada.
    // Lo que se guarda --y lo único que el aviso nombra-- es el estado que
    // vuelve; ver el comentario de `resultingStatus`.
    if (posted.ticketStatus !== shownBefore) setResultingStatus(posted.ticketStatus);

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
        if (!alive.current) return;
        setAttachmentIssues([...outcome.failed, ...outcome.skipped]);
      } catch {
        if (!alive.current) return;
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

      {resultingStatus && (
        // `role="status"` y no `alert`: es una buena noticia, no una
        // interrupción. Va junto al botón que lo provocó, además del distintivo
        // de la cabecera, que también ha cambiado ya.
        //
        // Se dice **dónde queda** el ticket, no de dónde venía ni por qué: es lo
        // único que la respuesta del `POST` permite afirmar.
        <p
          role="status"
          data-resulting-status={resultingStatus}
          className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900"
        >
          Recibimos tu mensaje. El ticket está ahora en «{STATUS_LABELS[resultingStatus]}».
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
