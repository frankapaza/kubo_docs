import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { portalApi } from '../../api/portal.api';
import type { PortalTicket, TicketStatus } from '../../api/types';
import { STATUS_LABELS } from '../tickets/ticket-ui';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { InboxIcon, PlusIcon } from '../../components/ui/Icon';
import NewPortalTicketDialog from './NewPortalTicketDialog';

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple';

/**
 * Colores del badge por estado. Los ocho valores son exactamente los de
 * `TicketStatus` (ver `web/src/api/types.ts`); el tipo `Record` obliga a
 * cubrirlos todos, así que un estado nuevo en el backend rompe el build en
 * vez de caer silenciosamente en un color por defecto.
 * Exportado para que `PortalTicketDetailPage` use el mismo criterio de color
 * que esta lista, en vez de mantener dos mapeos que puedan divergir.
 */
export const STATUS_TONES: Record<TicketStatus, BadgeTone> = {
  NUEVO: 'info',
  TRIAJE: 'purple',
  ASIGNADO: 'warning',
  EN_ATENCION: 'warning',
  ESPERA_CLIENTE: 'neutral',
  DERIVADO: 'purple',
  RESUELTO: 'success',
  CERRADO: 'neutral',
};

export function fmtDate(v: string): string {
  return new Date(v).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(v: string): string {
  return new Date(v).toLocaleString('es-PE');
}

export default function PortalTicketsListPage() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // `cancelled` evita que una respuesta lenta pise el estado si el usuario
  // ya navegó fuera de esta página antes de que llegue.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    portalApi
      .listTickets()
      .then((data) => {
        if (!cancelled) setTickets(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.response?.data?.message ?? 'No se pudo cargar la lista de tickets.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mis tickets</h1>
          <p className="text-sm text-slate-500 mt-1">
            Consulta el estado de tus solicitudes de soporte.
          </p>
        </div>
        <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => setDialogOpen(true)}>
          Nuevo ticket
        </Button>
      </div>

      <Card>
        {loading && <div className="p-8 text-center text-sm text-slate-500">Cargando…</div>}

        {!loading && error && (
          <div role="alert" className="m-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && tickets.length === 0 && (
          <EmptyState
            icon={<InboxIcon size={22} />}
            title="Todavía no tienes tickets"
            description="Cuando necesites soporte, crea un ticket y podrás seguir aquí su avance."
            action={
              <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => setDialogOpen(true)}>
                Crear el primero
              </Button>
            }
          />
        )}

        {!loading && !error && tickets.length > 0 && (
          <div className="divide-y divide-slate-100">
            {tickets.map((t) => (
              <Link
                key={t.id}
                to={`/portal/tickets/${t.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition"
              >
                <span className="w-20 flex-shrink-0 font-mono text-xs text-slate-500">
                  {t.code ?? `#${t.id}`}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                  {t.subject ?? '(sin asunto)'}
                </span>
                <Badge tone={STATUS_TONES[t.status]} dot>
                  {STATUS_LABELS[t.status]}
                </Badge>
                <span className="w-28 flex-shrink-0 text-right text-xs text-slate-500">
                  {fmtDate(t.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <NewPortalTicketDialog
        open={dialogOpen}
        onCancel={() => setDialogOpen(false)}
        onCreated={(created) => {
          setDialogOpen(false);
          // Ir directo al detalle: es donde el cliente ve el ticket recién
          // creado sin tener que recargar la lista a mano.
          navigate(`/portal/tickets/${created.id}`);
        }}
      />
    </div>
  );
}
