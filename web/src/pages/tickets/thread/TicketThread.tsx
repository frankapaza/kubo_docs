import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  /** Hay una recarga en curso: el botón de reintentar no admite una segunda. */
  const [reloading, setReloading] = useState(false);
  const [clientUsersById, setClientUsersById] = useState<Map<number, string>>(new Map());

  const fetchThread = useCallback(
    () => Promise.all([ticketMessagesApi.listThread(ticketId), ticketMessagesApi.listAttachments(ticketId)]),
    [ticketId],
  );

  /**
   * Guardas de la carga, que son dos cosas distintas:
   *
   * - `alive` corta el camino tardío tras desmontar.
   * - `requestSeq` decide **quién manda** cuando hay varias en vuelo: solo la
   *   última pedida escribe el estado. Sin esto, cambiar de ticket rápido o
   *   publicar dos veces seguidas deja que una respuesta vieja pise a una
   *   nueva, y en un hilo eso se ve como mensajes que desaparecen.
   */
  const alive = useRef(true);
  const requestSeq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const seq = ++requestSeq.current;
      if (mode === 'initial') setLoading(true);
      else setReloading(true);

      try {
        const [thread, files] = await fetchThread();
        if (!alive.current || seq !== requestSeq.current) return;
        setMessages(thread);
        setAttachments(files);
        // **Los dos**. El éxito borra también el error de carga: si no, la
        // lista se queda escondida detrás de un cuadro rojo que ya no describe
        // nada --un acierto tragado, que es la otra cara de tragarse un fallo--
        // y quien acaba de publicar concluye que su mensaje no entró y lo
        // vuelve a mandar.
        setLoadError(null);
        setRefreshError(null);
      } catch (failure) {
        if (!alive.current || seq !== requestSeq.current) return;
        console.warn('[TicketThread] No se pudo traer la conversación del ticket.', failure);
        if (mode === 'initial') {
          setLoadError('No se pudo cargar la conversación de este ticket.');
          // **También el otro.** Los dos avisos describen situaciones que se
          // excluyen: si no hay conversación en pantalla, no puede haber además
          // una «desactualizada». Dejar vivo el ámbar de un refresco anterior
          // ponía dos cajas con dos botones idénticos, y la de arriba hablaba de
          // «la conversación de abajo» cuando abajo no había nada.
          setRefreshError(null);
        } else {
          setRefreshError(
            'La conversación de abajo puede estar desactualizada: no se pudo volver a cargar.',
          );
        }
      } finally {
        if (alive.current && seq === requestSeq.current) {
          setLoading(false);
          setReloading(false);
        }
      }
    },
    [fetchThread],
  );

  // Carga inicial, y de nuevo cada vez que cambia el ticket.
  useEffect(() => {
    void load('initial');
  }, [load]);

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

  /**
   * Volver a pedir el hilo. Lo llaman los dos botones de reintentar y el
   * compositor cuando acaba de publicar.
   *
   * **El modo lo decide lo que hay en pantalla, no quién llamó.** «Inicial» y
   * «refresco» no son dos orígenes, son dos situaciones distintas del usuario:
   * en una no tiene conversación delante y en la otra sí. Con `reload` pidiendo
   * siempre un refresco, el reintento del cuadro rojo que volvía a fallar
   * escribía el aviso ámbar --«la conversación de abajo puede estar
   * desactualizada»-- sin borrar el rojo, y quedaban dos cajas con dos botones
   * iguales, una de ellas hablando de una lista que estaba suprimida. Si el
   * fallo de carga está en pie, no hay nada abajo: se reintenta la carga.
   *
   * Es el mismo arreglo que ya llevaba `PortalTicketThread`, retroportado: las
   * dos pantallas tienen el mismo par de avisos y no pueden manejarlos distinto.
   */
  const reload = useCallback(() => {
    void load(loadError ? 'initial' : 'refresh');
  }, [load, loadError]);

  /**
   * Los adjuntos, colgados de su mensaje.
   *
   * **Todo adjunto cuelga de un mensaje**: el alta del ticket crea el ticket
   * con su primer mensaje y la subida exige `messageId`, así que nada puede
   * crear ya una fila sin él. El que no cuelgue de ninguno es una **anomalía**
   * --una fila anterior a esa decisión, o algo que no debería existir--, y por
   * eso no se pierde: se avisa. Al cliente esa fila no le llega siquiera (el
   * `INNER JOIN` de `listAttachments` y el 404 de la descarga), así que el
   * único sitio donde se puede ver es este.
   */
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
            disabled={reloading}
            onClick={reload}
            className="rounded border border-amber-400 px-2 py-1 font-medium hover:bg-amber-100 disabled:opacity-50"
          >
            {reloading ? 'Actualizando…' : 'Reintentar'}
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
            disabled={reloading}
            onClick={reload}
            className="rounded border border-red-400 px-2 py-1 font-medium hover:bg-red-100 disabled:opacity-50"
          >
            {reloading ? 'Actualizando…' : 'Reintentar'}
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
            // Aviso de anomalía, no nota al pie: en gris claro se leía como una
            // explicación de algo normal --«son filas anteriores», y a otra
            // cosa--, y ya no lo es. Nada puede crear un adjunto sin mensaje,
            // así que si aparece uno hay algo que mirar.
            //
            // Ámbar en el trazo pero **fondo blanco**, a propósito: el relleno
            // `bg-amber-50` es la piel de la tarjeta de nota interna
            // (`message-visibility.ts` explica por qué ese color está reservado
            // en esta pantalla), y repetirlo en un bloque que no es un mensaje
            // erosionaría lo único que hace que un vistazo baste: «relleno
            // ámbar = esto no sale de Kubo».
            <div
              role="status"
              className="mt-3 rounded-lg border border-l-4 border-amber-400 bg-white px-3 py-2 text-[11px] text-amber-900"
            >
              <strong className="font-semibold">
                {orphans.length === 1
                  ? 'Hay 1 adjunto que no cuelga de ningún mensaje.'
                  : `Hay ${orphans.length} adjuntos que no cuelgan de ningún mensaje.`}
              </strong>{' '}
              No debería poder existir: hoy todo adjunto se sube dentro de un mensaje. Sin mensaje
              no hereda ninguna visibilidad, así que el cliente no los ve ni puede descargarlos, y
              solo aparecen aquí. Si son filas antiguas, no hay nada que hacer; si son recientes,
              conviene avisar.
            </div>
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
