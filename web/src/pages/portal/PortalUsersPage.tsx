import { useCallback, useEffect, useState } from 'react';

import { portalApi } from '../../api/portal.api';
import type { PortalInvitation, PortalTeamMember } from '../../api/types';
import { usePortalAuth } from '../../auth/PortalAuthContext';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { UsersIcon, PlusIcon } from '../../components/ui/Icon';
import { fmtDate } from './PortalTicketsListPage';
import InvitePortalUserDialog from './InvitePortalUserDialog';

/**
 * Misma pregunta que hace el servidor en `PortalUsersService.deactivate`, en
 * el mismo orden de motivos: no es uno mismo, y no es OTRO administrador
 * (decisiones 5 y 9 de la spec). Esconder el botón cuando la respuesta es
 * "no" NO es la defensa -- el servidor rechaza la operación igual, con su
 * propio mensaje--; esto solo evita ofrecer un botón que ya sabemos que va a
 * fallar. Que quede en una función aparte, y no repetido en el JSX, es para
 * que si el servidor añade algún día un cuarto motivo, aquí solo hay un sitio
 * que tocar.
 */
function canDeactivate(member: PortalTeamMember, selfId: number | undefined): boolean {
  return member.isActive && member.id !== selfId && !member.isAdmin;
}

export default function PortalUsersPage() {
  const { clientUser } = usePortalAuth();
  const [team, setTeam] = useState<PortalTeamMember[]>([]);
  const [invitations, setInvitations] = useState<PortalInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Ids de fila con una acción en curso (reenviar o desactivar). Freno contra
  // el doble clic sobre la misma fila mientras la petición sigue en vuelo:
  // un segundo "Reenviar" antes de que vuelva el primero emitiría un segundo
  // enlace que anula al que el primer clic acababa de pedir.
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([portalApi.listTeam(), portalApi.listInvitations()])
      .then(([t, i]) => {
        if (cancelled) return;
        setTeam(t);
        setInvitations(i);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.response?.data?.message ?? 'No se pudo cargar la lista de tu equipo.');
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

  const withBusy = (id: number, run: () => Promise<unknown>) => {
    if (busyIds.has(id)) return;
    setError(null);
    setBusyIds((prev) => new Set(prev).add(id));
    run()
      .then(() => load())
      .catch((e) => setError(e?.response?.data?.message ?? 'No se pudo completar la acción. Inténtalo de nuevo.'))
      .finally(() => {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
  };

  const deactivate = (m: PortalTeamMember) => withBusy(m.id, () => portalApi.deactivateTeamMember(m.id));

  // Ids de invitación en un espacio distinto al de `team`, pero ambos son
  // identificadores de fila numéricos de esta misma pantalla -- se comparten
  // el mismo `Set` de "en vuelo" porque nunca coinciden en la misma tabla.
  const resend = (i: PortalInvitation) => withBusy(i.id, () => portalApi.resendInvitation(i.id));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mi equipo</h1>
          <p className="text-sm text-slate-500 mt-1">
            Da acceso al portal a la gente de tu empresa, o quítaselo a quien ya no está.
          </p>
        </div>
        <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => setDialogOpen(true)}>
          Invitar
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading && <div className="p-8 text-center text-sm text-slate-500">Cargando…</div>}

      {!loading && invitations.length > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Invitaciones pendientes</h2>
          <p className="text-xs text-slate-500 mb-3">
            Todavía no son usuarios: no han elegido su contraseña. Reenviar emite un enlace nuevo
            y anula el anterior -- si la persona ya tenía el primer correo, ese enlace deja de
            funcionar.
          </p>
          <ul className="divide-y divide-slate-100">
            {invitations.map((i) => (
              <li key={i.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{i.fullName}</p>
                  <p className="text-xs text-slate-500 truncate">{i.email}</p>
                  {/*
                    La invitación existe, el administrador la ve pendiente, y
                    la persona no recibe nada porque el correo se perdió o
                    cayó en no deseado. Que el fallo del envío se VEA es lo
                    que convierte el reenvío en un reintento útil en vez de en
                    un botón a ciegas.
                  */}
                  {i.deliveryFailed && (
                    <p className="text-xs text-amber-600 mt-1">
                      No se pudo entregar el correo. Reenvíalo, o revisa que la dirección esté
                      bien escrita.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Badge tone="warning">Pendiente</Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => resend(i)}
                    disabled={busyIds.has(i.id)}
                  >
                    Reenviar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!loading && team.length === 0 && (
        <EmptyState
          icon={<UsersIcon size={32} />}
          title="Todavía no hay nadie más"
          description="Invita a la gente de tu empresa para que pueda abrir tickets y seguir sus requerimientos."
        />
      )}

      {!loading && team.length > 0 && (
        <Card>
          <ul className="divide-y divide-slate-100">
            {team.map((m) => (
              <li key={m.id} className="py-3 px-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{m.fullName}</p>
                  <p className="text-xs text-slate-500 truncate">{m.email}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {m.lastLoginAt ? `Última entrada: ${fmtDate(m.lastLoginAt)}` : 'Nunca ha entrado'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {m.isAdmin && <Badge tone="primary">Administra</Badge>}
                  {m.isActive ? (
                    <Badge tone="success">Con acceso</Badge>
                  ) : (
                    <Badge tone="neutral">Sin acceso</Badge>
                  )}
                  {/*
                    El botón no se ofrece para uno mismo ni para otro
                    administrador. Esconderlo NO es la defensa -- el servidor
                    rechaza igual las dos operaciones
                    (`PortalUsersService.deactivate`, decisiones 5 y 9 de la
                    spec)--; esto solo evita mostrar algo que se va a denegar.
                    Mismo criterio que el botón de alta de requerimientos
                    frente a `ClientAdminGuard`.
                  */}
                  {canDeactivate(m, clientUser?.id) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => deactivate(m)}
                      disabled={busyIds.has(m.id)}
                    >
                      Quitar acceso
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <InvitePortalUserDialog
        open={dialogOpen}
        onCancel={() => setDialogOpen(false)}
        onInvited={() => {
          setDialogOpen(false);
          load();
        }}
      />
    </div>
  );
}
