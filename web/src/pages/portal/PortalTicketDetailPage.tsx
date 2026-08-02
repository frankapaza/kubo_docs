import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { portalApi } from '../../api/portal.api';
import type { PortalTicketDetail, PortalTicketEventType } from '../../api/types';
import { STATUS_LABELS } from '../tickets/ticket-ui';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ArrowLeftIcon } from '../../components/ui/Icon';
import { STATUS_TONES, fmtDateTime } from './PortalTicketsListPage';

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

  // `cancelled` evita que una carga obsoleta (tras navegar rápido entre
  // tickets) pise el estado de la vista actual.
  useEffect(() => {
    if (!Number.isFinite(id)) {
      // Id de ruta no numérico (URL manual, enlace obsoleto): sin este corte
      // explícito `loading` se queda en `true` para siempre, porque nunca se
      // dispara ni el `.then` ni el `.catch` de abajo.
      setLoading(false);
      setError('Ticket no encontrado');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    portalApi
      .getTicket(id)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.response?.data?.message ?? 'No se pudo cargar el ticket.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

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
