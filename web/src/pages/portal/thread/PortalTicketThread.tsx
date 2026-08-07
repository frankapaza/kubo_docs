import { useCallback, useEffect, useRef, useState } from 'react';

import { portalTicketMessagesApi } from '../../../api/ticket-messages.api';
import type { PortalTicketMessage, TicketStatus } from '../../../api/types';
import PortalThreadComposer from './PortalThreadComposer';
import PortalThreadMessage from './PortalThreadMessage';

/**
 * La conversación de un ticket **en el portal del cliente**: lo que se ha dicho
 * y el sitio donde se dice lo siguiente.
 *
 * Va aparte del «Historial» por lo mismo que en el panel: el historial es el
 * registro de lo que le pasó al ticket y se lee por encima; el hilo es una
 * conversación entre personas, se lee de arriba abajo y se responde desde el
 * final. Es además la decisión que el backend ya tomó al dejar `MESSAGE_POSTED`
 * fuera de los eventos visibles del cliente, «porque el hilo se muestra aparte».
 *
 * **Una sola petición, y del portal.** `GET /portal/tickets/:id/messages`
 * devuelve los mensajes con sus adjuntos dentro, ya proyectados campo por campo
 * por el backend: sin `visibility`, sin identificadores de autor y sin las notas
 * internas, que el servicio no llega ni a leer. De ahí que aquí no haya nada que
 * filtrar ni que emparejar --el panel sí lo hace, porque allí los adjuntos vienen
 * de un endpoint distinto-- y de ahí, sobre todo, que esta pantalla **no llame a
 * ningún endpoint del panel**: son otra ruta, otra instancia de axios y otro
 * token (ver el docblock de `ticket-messages.api.ts`).
 */
interface PortalTicketThreadProps {
  ticketId: number;
  /** El estado actual del ticket, tal y como lo enseña la cabecera de la ficha. */
  ticketStatus: TicketStatus;
  /** El estado que devolvió el `POST`, para que la ficha lo refleje sin recargar. */
  onTicketStatus: (status: TicketStatus) => void;
}

export default function PortalTicketThread({
  ticketId,
  ticketStatus,
  onTicketStatus,
}: PortalTicketThreadProps) {
  const [messages, setMessages] = useState<PortalTicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  /** No se pudo traer el hilo la primera vez: no hay nada que enseñar. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * Sí hay hilo en pantalla, pero está viejo porque el refresco falló. Se cuenta
   * aparte del fallo de envío del compositor **y con otras palabras**: uno
   * significa «no se envió nada» y el otro «se envió, pero esta lista no lo
   * refleja». Confundirlos lleva a escribir el mensaje dos veces.
   */
  const [refreshError, setRefreshError] = useState<string | null>(null);
  /** Hay una recarga en curso: el botón de reintentar no admite una segunda. */
  const [reloading, setReloading] = useState(false);

  /**
   * Guardas de la carga, que son dos cosas distintas:
   *
   * - `alive` corta el camino tardío tras desmontar.
   * - `requestSeq` decide **quién manda** cuando hay varias en vuelo: solo la
   *   última pedida escribe el estado. Sin esto, una respuesta vieja puede pisar
   *   a una nueva, y en un hilo eso se ve como mensajes que desaparecen.
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
        const thread = await portalTicketMessagesApi.listThread(ticketId);
        if (!alive.current || seq !== requestSeq.current) return;
        setMessages(thread);
        // **Los dos**. El éxito borra también el error de carga: si no, la lista
        // se queda escondida detrás de un cuadro rojo que ya no describe nada
        // --un acierto tragado, que es la otra cara de tragarse un fallo-- y
        // quien acaba de escribir concluye que su mensaje no entró y lo vuelve a
        // mandar.
        setLoadError(null);
        setRefreshError(null);
      } catch (failure) {
        if (!alive.current || seq !== requestSeq.current) return;
        console.warn('[PortalTicketThread] No se pudo traer la conversación del ticket.', failure);
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
    [ticketId],
  );

  // Carga inicial, y de nuevo cada vez que cambia el ticket.
  useEffect(() => {
    void load('initial');
  }, [load]);

  /**
   * Volver a pedir el hilo. Lo llaman los dos botones de reintentar y el
   * compositor cuando acaba de escribir.
   *
   * **El modo lo decide lo que hay en pantalla, no quién llamó.** «Inicial» y
   * «refresco» no son dos orígenes, son dos situaciones distintas del usuario:
   * en una no tiene conversación delante y en la otra sí. Con `reload` pidiendo
   * siempre un refresco, el reintento del cuadro rojo que volvía a fallar
   * escribía el aviso ámbar --«la conversación de abajo puede estar
   * desactualizada»-- sin borrar el rojo, y quedaban dos cajas con dos botones
   * iguales, una de ellas hablando de una lista que estaba suprimida. Si el
   * fallo de carga está en pie, no hay nada abajo: se reintenta la carga.
   */
  const reload = useCallback(() => {
    void load(loadError ? 'initial' : 'refresh');
  }, [load, loadError]);

  const closed = ticketStatus === 'CERRADO';

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-slate-900">Conversación</h2>
        <span className="text-[11px] text-slate-500">
          Aquí hablas con el equipo de soporte de Kubo.
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

      {!loading &&
        !loadError &&
        (messages.length === 0 ? (
          <p className="text-xs text-slate-500">
            {closed
              ? // Sin esta rama, un ticket cerrado y sin mensajes invitaba a
                // escribir el primero justo encima del aviso que dice que ya no
                // se puede: dos frases seguidas que se contradicen.
                'Este ticket se cerró sin ningún mensaje en la conversación.'
              : 'Todavía no hay mensajes. El primero que escribas abre la conversación con soporte.'}
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((message) => (
              <li key={message.id}>
                <PortalThreadMessage message={message} />
              </li>
            ))}
          </ol>
        ))}

      <div className="mt-4">
        {closed ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Este ticket está cerrado y su conversación no admite mensajes nuevos. Si el problema
            vuelve, crea un ticket nuevo desde «Mis tickets».
          </p>
        ) : (
          <PortalThreadComposer
            ticketId={ticketId}
            ticketStatus={ticketStatus}
            onPosted={reload}
            onTicketStatus={onTicketStatus}
          />
        )}
      </div>
    </section>
  );
}
