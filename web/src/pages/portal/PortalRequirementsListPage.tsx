import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { portalApi } from '../../api/portal.api';
import type { PortalRequirement, PortalRequirementStatusLabel } from '../../api/types';
import { usePortalAuth } from '../../auth/PortalAuthContext';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { FileTextIcon, PlusIcon } from '../../components/ui/Icon';
import { fmtDate, fmtDateOnly } from './PortalTicketsListPage';
import NewPortalRequirementDialog from './NewPortalRequirementDialog';

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple';

/**
 * Colores del badge por estado. Los ocho valores son exactamente los de
 * `PortalRequirementStatusLabel` (ver `web/src/api/types.ts`) -- ya
 * traducidos por el backend, así que se pintan tal cual y solo se decide el
 * color aquí. El `Record` obliga a cubrirlos todos: un estado nuevo del lado
 * del servidor rompe el build en vez de caer en un color por defecto.
 * Exportado para que `PortalRequirementDetailPage` use el mismo criterio de
 * color que esta lista, en vez de mantener dos mapeos que puedan divergir.
 */
export const REQUIREMENT_STATUS_TONES: Record<PortalRequirementStatusLabel, BadgeTone> = {
  Solicitado: 'info',
  'Aceptado, en cola': 'purple',
  'En desarrollo': 'primary',
  'En pruebas': 'warning',
  Entregado: 'success',
  Bloqueado: 'danger',
  Cancelado: 'neutral',
  Rechazado: 'danger',
};

/**
 * Fecha comprometida para el listado y el detalle: mientras el requerimiento
 * no ha sido aceptado, el backend manda `null` y aquí se lee como «todavía
 * no», no como «no hay». Un guion se confunde con «no aplica»; este texto no.
 *
 * Usa `fmtDateOnly` y no `fmtDate`: `committedDate` es la columna `due_date`
 * (`DATE`, `YYYY-MM-DD`, ver `PortalRequirement` en `types.ts`), no una marca
 * de tiempo completa -- `fmtDate` la interpretaría como medianoche UTC y la
 * mostraría un día antes de la real en un navegador en Perú (UTC-5).
 *
 * Exportada por el mismo motivo que `REQUIREMENT_STATUS_TONES`.
 */
export function fmtCommittedDate(v: string | null): string {
  return v ? fmtDateOnly(v) : 'Pendiente de aceptación';
}

export default function PortalRequirementsListPage() {
  const { clientUser } = usePortalAuth();
  const [requirements, setRequirements] = useState<PortalRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // `cancelled` evita que una respuesta lenta pise el estado si el usuario ya
  // navegó fuera de esta página antes de que llegue. `load` se expone (no un
  // simple efecto suelto) porque tras un alta hay que volver a pedir la
  // lista sin recargar toda la página.
  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    portalApi
      .listRequirements()
      .then((data) => {
        if (!cancelled) setRequirements(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.response?.data?.message ?? 'No se pudo cargar la lista de requerimientos.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mis requerimientos</h1>
          <p className="text-sm text-slate-500 mt-1">
            Sigue el avance de lo que le has pedido construir a nuestro equipo.
          </p>
        </div>
        {/*
          Esconder el botón no es la defensa: `ClientAdminGuard`, en el
          backend, es quien de verdad impide el alta a un cliente que no
          administra su cuenta, y ya está probado ahí. Esto solo evita
          ofrecerle un botón que el servidor le va a rechazar igual.
        */}
        {clientUser?.isAdmin && (
          <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => setDialogOpen(true)}>
            Pedir un requerimiento
          </Button>
        )}
      </div>

      <Card>
        {loading && <div className="p-8 text-center text-sm text-slate-500">Cargando…</div>}

        {!loading && error && (
          <div role="alert" className="m-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && requirements.length === 0 && (
          <EmptyState
            icon={<FileTextIcon size={22} />}
            title={
              clientUser?.isAdmin
                ? 'Todavía no has pedido ningún requerimiento.'
                : 'Tu empresa todavía no ha pedido ningún requerimiento. Puede hacerlo el administrador de tu cuenta.'
            }
            action={
              clientUser?.isAdmin ? (
                <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => setDialogOpen(true)}>
                  Pedir el primero
                </Button>
              ) : undefined
            }
          />
        )}

        {!loading && !error && requirements.length > 0 && (
          <div className="divide-y divide-slate-100">
            {requirements.map((r) => (
              <Link
                key={r.id}
                to={`/portal/requerimientos/${r.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition"
              >
                <span className="w-20 flex-shrink-0 font-mono text-xs text-slate-500">
                  {r.code ?? `#${r.id}`}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                  {r.title}
                </span>
                <Badge tone={REQUIREMENT_STATUS_TONES[r.status]} dot>
                  {r.status}
                </Badge>
                <span className="w-36 flex-shrink-0 text-right text-xs text-slate-500">
                  {fmtCommittedDate(r.committedDate)}
                </span>
                <span className="w-28 flex-shrink-0 text-right text-xs text-slate-500">
                  {fmtDate(r.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <NewPortalRequirementDialog
        open={dialogOpen}
        onCancel={() => setDialogOpen(false)}
        onCreated={() => {
          setDialogOpen(false);
          // A diferencia del alta de tickets, aquí no hay un detalle con hilo
          // y adjuntos al que valga la pena saltar: basta con recargar el
          // listado para que el cliente vea su requerimiento recién creado.
          load();
        }}
      />
    </div>
  );
}
