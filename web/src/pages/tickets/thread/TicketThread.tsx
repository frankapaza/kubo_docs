import { useCallback, useEffect, useMemo, useState } from 'react';

import { clientUsersApi } from '../../../api/client-users.api';
import { ticketMessagesApi } from '../../../api/ticket-messages.api';
import type { TicketAttachment, TicketMessage, TicketStatus } from '../../../api/types';
import ThreadComposer from './ThreadComposer';
import ThreadMessage from './ThreadMessage';

/**
 * La conversación de un ticket en el panel interno: lo que se ha dicho y el
 * sitio donde se dice lo siguiente.
 *
 * **Por qué va aparte del «Historial» y no entrelazado con él.** Son dos cosas
 * distintas que se leen de forma distinta:
 *
 * - El historial es el **registro de lo que le pasó al ticket**: se creó, se
 *   asignó, cambió de estado, el SLA se puso en riesgo. Casi todo lo escribe el
 *   sistema, se consulta hacia atrás y se lee por encima.
 * - El hilo es una **conversación entre personas**: se lee de arriba abajo, se
 *   responde desde el final y cada línea tiene un autor.
 *
 * Entrelazarlos parece que da «una sola verdad ordenada por fecha», pero cuesta
 * tres cosas. La primera es que el ruido de máquina --tres eventos de SLA entre
 * dos frases-- parte la conversación justo donde hay que seguir el hilo. La
 * segunda es que metería el formulario de escribir dentro de un registro de
 * auditoría, que es un sitio donde no se escribe. Y la tercera es la que decide,
 * porque va al fondo de esta pantalla: en una lista mezclada conviven elementos
 * que **tienen** destinatario (los mensajes) con elementos que **no** (los
 * eventos), y entonces «¿esto lo lee el cliente?» deja de tener respuesta por la
 * forma del elemento. Todo el diseño de aquí se apoya en que esa pregunta se
 * conteste de un vistazo; una lista donde a veces la pregunta no aplica la
 * vuelve a hacer dudosa.
 *
 * Es además la misma decisión que ya tomó el backend para el portal, donde
 * `MESSAGE_POSTED` se dejó fuera de los eventos visibles del cliente
 * precisamente porque «el hilo se muestra aparte».
 *
 * Consecuencia coherente en el panel: `TicketDetailPage` quita los
 * `MESSAGE_POSTED` del historial, porque el hilo los enseña enteros unos
 * centímetros más arriba y en el historial solo serían una línea repetida --y
 * una línea que además delataría el número de notas internas sin decir nada de
 * ellas.
 */
interface TicketThreadProps {
  ticketId: number;
  ticketStatus: TicketStatus;
  clientId: number | null;
  /** Razón social del cliente, ya resuelta por la ficha. */
  clientName: string | null;
  /** Nombres del equipo por id, los que la ficha ya cargó de `/support-agents`. */
  staffNamesById: Map<number, string>;
}

export default function TicketThread({
  ticketId,
  ticketStatus,
  clientId,
  clientName,
  staffNamesById,
}: TicketThreadProps) {
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  /** No se pudo traer el hilo la primera vez: no hay nada que enseñar. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * Sí hay hilo en pantalla, pero está viejo porque el refresco falló. Se
   * cuenta aparte del fallo de escritura del compositor **y con otras
   * palabras**: uno significa «no se guardó nada» y el otro «se guardó, pero
   * esta lista no lo refleja». Confundirlos lleva a escribir el mensaje dos
   * veces.
   */
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [clientUsersById, setClientUsersById] = useState<Map<number, string>>(new Map());

  const fetchThread = useCallback(
    () => Promise.all([ticketMessagesApi.listThread(ticketId), ticketMessagesApi.listAttachments(ticketId)]),
    [ticketId],
  );

  // Carga inicial. `cancelled` evita que una respuesta de un ticket que ya no
  // se está mirando pise el hilo del actual.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setRefreshError(null);

    fetchThread()
      .then(([thread, files]) => {
        if (cancelled) return;
        setMessages(thread);
        setAttachments(files);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        console.warn('[TicketThread] No se pudo cargar el hilo del ticket.', failure);
        setLoadError('No se pudo cargar la conversación de este ticket.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchThread]);

  // Los nombres del lado del cliente. Si la petición falla (un rol sin permiso
  // sobre el catálogo, por ejemplo), el hilo se sigue leyendo: los mensajes del
  // cliente salen con su identificador en vez de con su nombre, y el motivo
  // queda en la consola. Perder el nombre no justifica perder la conversación.
  useEffect(() => {
    if (clientId === null) {
      setClientUsersById(new Map());
      return;
    }
    let cancelled = false;
    clientUsersApi
      .listByClient(clientId)
      .then((users) => {
        if (!cancelled) setClientUsersById(new Map(users.map((u) => [u.id, u.fullName])));
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        console.warn(
          '[TicketThread] No se pudieron cargar los usuarios del cliente; el hilo mostrará ids.',
          failure,
        );
        setClientUsersById(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const reload = useCallback(() => {
    setRefreshError(null);
    fetchThread()
      .then(([thread, files]) => {
        setMessages(thread);
        setAttachments(files);
      })
      .catch((failure: unknown) => {
        console.warn('[TicketThread] No se pudo refrescar el hilo.', failure);
        setRefreshError(
          'La conversación de abajo puede estar desactualizada: no se pudo volver a cargar.',
        );
      });
  }, [fetchThread]);

  /** Los adjuntos, colgados de su mensaje. Los huérfanos no se pierden: van al final. */
  const byMessage = useMemo(() => {
    const map = new Map<number, TicketAttachment[]>();
    for (const attachment of attachments) {
      if (attachment.messageId === null) continue;
      const list = map.get(attachment.messageId);
      if (list) list.push(attachment);
      else map.set(attachment.messageId, [attachment]);
    }
    return map;
  }, [attachments]);

  const orphans = useMemo(
    () => attachments.filter((attachment) => attachment.messageId === null),
    [attachments],
  );

  const authorName = (message: TicketMessage): string => {
    if (message.authorUserId !== null) {
      return staffNamesById.get(message.authorUserId) ?? `Equipo Kubo (#${message.authorUserId})`;
    }
    if (message.authorClientUserId !== null) {
      const name = clientUsersById.get(message.authorClientUserId);
      return name ?? `Usuario del cliente #${message.authorClientUserId}`;
    }
    // No debería ocurrir --el backend exige un autor-- pero si una fila vieja
    // llega sin ninguno, se dice en vez de inventarse un nombre.
    return 'Autor desconocido';
  };

  const closed = ticketStatus === 'CERRADO';

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-slate-900">Conversación</h2>
        <span className="text-[11px] text-slate-500">
          Las respuestas llegan al cliente; las notas internas, no.
        </span>
      </div>

      {refreshError && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          <span className="flex-1">{refreshError}</span>
          <button
            type="button"
            onClick={reload}
            className="rounded border border-amber-400 px-2 py-1 font-medium hover:bg-amber-100"
          >
            Reintentar
          </button>
        </div>
      )}

      {loading && <p className="text-xs text-slate-500">Cargando la conversación…</p>}

      {!loading && loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          <span className="flex-1">{loadError}</span>
          <button
            type="button"
            onClick={reload}
            className="rounded border border-red-400 px-2 py-1 font-medium hover:bg-red-100"
          >
            Reintentar
          </button>
        </div>
      )}

      {!loading && !loadError && (
        <>
          {messages.length === 0 ? (
            <p className="text-xs text-slate-500">
              Todavía no hay mensajes. El primero que escribas abre la conversación.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {messages.map((message) => (
                <li key={message.id}>
                  <ThreadMessage
                    message={message}
                    attachments={byMessage.get(message.id) ?? []}
                    authorName={authorName(message)}
                  />
                </li>
              ))}
            </ol>
          )}

          {orphans.length > 0 && (
            <p className="mt-3 text-[11px] text-slate-500">
              Hay {orphans.length}{' '}
              {orphans.length === 1 ? 'adjunto sin mensaje' : 'adjuntos sin mensaje'} en este
              ticket. Son filas anteriores a la conversación y no cuelgan de ningún mensaje.
            </p>
          )}
        </>
      )}

      <div className="mt-4">
        {closed ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            El ticket está cerrado y su hilo no admite mensajes nuevos. Para seguir hablando de
            esto hay que abrir un ticket nuevo.
          </p>
        ) : (
          <ThreadComposer ticketId={ticketId} clientName={clientName} onPosted={reload} />
        )}
      </div>
    </section>
  );
}
