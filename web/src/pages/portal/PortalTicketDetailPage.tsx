import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { portalApi } from '../../api/portal.api';
import type { PortalTicketDetail, PortalTicketEventType, TicketStatus } from '../../api/types';
import { STATUS_LABELS } from '../tickets/ticket-ui';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ArrowLeftIcon } from '../../components/ui/Icon';
import { STATUS_TONES, fmtDateTime } from './PortalTicketsListPage';
import PortalTicketThread from './thread/PortalTicketThread';

/**
 * Etiquetas de los tipos de evento visibles en el portal. Son exactamente
 * los ocho de `PortalTicketEventType` (ver `web/src/api/types.ts`, que a su
 * vez refleja la lista blanca `CLIENT_VISIBLE_EVENT_TYPES` del backend): el
 * `Record` obliga a cubrirlos todos, sin motivo ni actor porque el backend
 * no los manda en esta proyección.
 */
const EVENT_LABELS: Record<PortalTicketEventType, string> = {
  CREATED: 'Ticket creado',
  TRIAGED: 'Triaje realizado',
  STATUS_CHANGED: 'Cambio de estado',
  TAKEN: 'Tomado por soporte',
  ESCALATED: 'Derivado',
  RESOLVED: 'Resuelto',
  REOPENED: 'Reabierto',
  CLOSED: 'Cerrado',
};

export default function PortalTicketDetailPage() {
  const { ticketId } = useParams();
  const id = Number(ticketId);

  const [detail, setDetail] = useState<PortalTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Las dos guardas de siempre: `alive` corta el camino tardío tras desmontar y
   * `detailSeq` decide quién manda cuando hay varias cargas en vuelo --navegar
   * rápido entre tickets, o un refresco que adelanta a la carga inicial--. Solo
   * la última pedida escribe el estado.
   */
  const alive = useRef(true);
  const detailSeq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Trae la ficha entera, cabecera **e historial**.
   *
   * `mode` no es de dónde viene la llamada, es qué hay en pantalla mientras
   * tanto. En `'initial'` no hay ficha y se enseña «Cargando…»; en `'refresh'`
   * sí la hay, así que no se vacía nada y un fallo **no** se convierte en el
   * cuadro rojo que sustituye a la página: se queda en el log y la ficha sigue
   * donde estaba, que es exactamente lo que pasaba antes de refrescar. Tirar
   * una ficha buena por un refresco fallido sería cambiar un desajuste por una
   * pérdida.
   */
  const loadDetail = useCallback(async (mode: 'initial' | 'refresh') => {
    if (!Number.isFinite(id)) {
      // Id de ruta no numérico (URL manual, enlace obsoleto): sin este corte
      // explícito `loading` se queda en `true` para siempre.
      setLoading(false);
      setError('Ticket no encontrado');
      return;
    }
    const seq = ++detailSeq.current;
    if (mode === 'initial') {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await portalApi.getTicket(id);
      if (!alive.current || seq !== detailSeq.current) return;
      setDetail(data);
      setError(null);
    } catch (e: any) {
      if (!alive.current || seq !== detailSeq.current) return;
      if (mode === 'initial') {
        setError(e?.response?.data?.message ?? 'No se pudo cargar el ticket.');
      } else {
        console.warn('[PortalTicketDetailPage] No se pudo refrescar la ficha del ticket.', e);
      }
    } finally {
      if (alive.current && seq === detailSeq.current && mode === 'initial') setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadDetail('initial');
  }, [loadDetail]);

  /**
   * Espejo del estado que la ficha tiene ahora mismo en pantalla.
   *
   * Existe para poder compararlo **fuera** del actualizador de `setDetail`: un
   * actualizador tiene que ser puro, y disparar una petición desde dentro lo
   * haría correr dos veces bajo `StrictMode`. Leerlo de `detail` directamente
   * obligaría a poner `detail` en las dependencias de `applyTicketStatus`, que
   * es justo la referencia estable que hay que conservar (ver abajo).
   */
  const shownStatus = useRef<TicketStatus | null>(null);
  useEffect(() => {
    shownStatus.current = detail?.status ?? null;
  }, [detail]);

  /**
   * El estado que devolvió el `POST` del hilo, aplicado a la ficha que ya está
   * en pantalla.
   *
   * Es lo que hace **visible la reactivación**: un cliente que responde a un
   * ticket en «Espera cliente» lo ve pasar a «En atención» en el mismo sitio de
   * siempre, sin recargar. Sin esto, la cabecera seguiría diciendo que el ticket
   * le espera a él justo después de haber contestado, y la lectura natural de
   * eso es que el mensaje no llegó -- así que lo vuelve a mandar.
   *
   * Se toma el estado de la respuesta y no se deduce aquí: el backend condiciona
   * la reactivación al estado que leyó dentro de su transacción y puede haber
   * decidido no mover nada (el ticket ya no estaba donde creíamos). Adivinarlo
   * desde este lado sería enseñar una transición que no ocurrió.
   *
   * **Y el historial se vuelve a pedir.** Parchear solo `status` dejaba las dos
   * mitades de la misma pantalla contando cosas distintas: la cabecera ya decía
   * «En atención» y el historial de abajo, que es el registro de por qué está
   * ahí, seguía sin el `STATUS_CHANGED` hasta la siguiente carga entera. Al
   * cliente que acaba de escribir eso se le lee como que su mensaje movió el
   * distintivo pero no quedó apuntado en ninguna parte --y el historial es
   * justo el sitio donde mira para comprobar que las cosas pasaron.
   *
   * El parche local se mantiene además de la petición, y no se sustituye por
   * ella: es instantáneo y no puede fallar, mientras que el refresco tarda y
   * puede no llegar. Si no llega, la cabecera ya está bien y el historial se
   * queda como estaba, que es donde estaba de todas formas.
   *
   * Solo en el portal. En el panel el historial y el hilo se refrescan por su
   * cuenta y `TicketDetailPage` quita los `MESSAGE_POSTED`, así que allí no hay
   * este desajuste.
   *
   * `useCallback` sin depender de `detail`: baja por props hasta el compositor y
   * una referencia estable es lo que evita que acabe algún día dentro de un
   * `useEffect` de allí provocando un ciclo de renderizados. Por eso la
   * comparación va contra `shownStatus`, no contra `detail`.
   */
  const applyTicketStatus = useCallback(
    (status: TicketStatus) => {
      // Se avisa siempre, cambie o no; aquí se decide. Si no cambió, no hay ni
      // que parchear ni que volver a pedir nada.
      if (shownStatus.current === null || shownStatus.current === status) return;
      shownStatus.current = status;
      setDetail((current) => (current ? { ...current, status } : current));
      void loadDetail('refresh');
    },
    [loadDetail],
  );

  return (
    <div className="space-y-6">
      <Link
        to="/portal/tickets"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition"
      >
        <ArrowLeftIcon size={14} />
        Volver a mis tickets
      </Link>

      {loading && <div className="p-8 text-center text-sm text-slate-500">Cargando…</div>}

      {!loading && (error || !detail) && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error ?? 'Ticket no encontrado'}
        </div>
      )}

      {!loading && detail && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm text-slate-500">{detail.code ?? `#${detail.id}`}</span>
            <Badge tone={STATUS_TONES[detail.status]} dot>
              {STATUS_LABELS[detail.status]}
            </Badge>
            <span className="ml-auto text-xs text-slate-500">Creado el {fmtDateTime(detail.createdAt)}</span>
          </div>

          {(detail.resolvedAt || detail.closedAt) && (
            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              {detail.resolvedAt && <span>Resuelto el {fmtDateTime(detail.resolvedAt)}</span>}
              {detail.closedAt && <span>Cerrado el {fmtDateTime(detail.closedAt)}</span>}
            </div>
          )}

          <Card>
            <CardBody>
              <h1 className="text-lg font-semibold text-slate-900">{detail.subject ?? '(sin asunto)'}</h1>
              {detail.descriptionMd && (
                <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-700">
                  {detail.descriptionMd}
                </pre>
              )}
            </CardBody>
          </Card>

          {/*
            El hilo va **antes** del historial y no dentro: se lee de arriba
            abajo y se responde desde el final, mientras que el historial es un
            registro que se consulta hacia atrás. Ver el docblock de
            `PortalTicketThread`.
          */}
          <PortalTicketThread
            ticketId={detail.id}
            ticketStatus={detail.status}
            onTicketStatus={applyTicketStatus}
          />

          <Card>
            <CardHeader title="Historial" />
            <CardBody>
              {detail.timeline.length === 0 ? (
                <p className="text-sm text-slate-500">Sin eventos todavía.</p>
              ) : (
                <ol className="space-y-4">
                  {detail.timeline.map((e, i) => (
                    <li key={`${e.type}-${e.createdAt}-${i}`} className="flex gap-3">
                      <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-kubo-primary" aria-hidden />
                      <div>
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-sm font-medium text-slate-900">{EVENT_LABELS[e.type]}</span>
                          <span className="font-mono text-xs text-slate-400">{fmtDateTime(e.createdAt)}</span>
                        </div>
                        {e.fromStatus && e.toStatus && (
                          <p className="mt-0.5 text-xs text-slate-500">
                            {STATUS_LABELS[e.fromStatus]} → {STATUS_LABELS[e.toStatus]}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
