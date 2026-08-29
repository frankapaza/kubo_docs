import { useCallback, useEffect, useRef, useState } from 'react';

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

/**
 * De qué tabla es el identificador de una acción en vuelo.
 *
 * Los ids de `client_users` y los de `client_user_invitations` son DOS
 * secuencias independientes, así que se repiten constantemente: la invitación
 * número 3 y el usuario número 3 existen a la vez sin ninguna relación. El
 * freno anterior los metía en el mismo conjunto con un comentario que afirmaba
 * que «nunca coinciden», y era falso — reenviar la invitación 3 deshabilitaba
 * el botón del usuario 3.
 */
type Espacio = 'invitacion' | 'usuario';

/** La clave de una acción en vuelo: la tabla y el id, nunca el id a secas. */
const claveDe = (espacio: Espacio, id: number): string => `${espacio}:${id}`;

export default function PortalUsersPage() {
  const { clientUser } = usePortalAuth();
  const [team, setTeam] = useState<PortalTeamMember[]>([]);
  const [invitations, setInvitations] = useState<PortalInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  /**
   * Freno **síncrono** al doble clic, marcado antes de cualquier `await`.
   *
   * Antes esto era un conjunto DEL ESTADO, y eso no frena nada: dos clics en
   * el mismo instante pasan los dos, porque el `set…` del estado no se ha
   * comprometido todavía ni el botón se ha repintado. En «Reenviar» eso son **dos
   * invitaciones**: la segunda revoca a la primera y la persona recibe dos
   * correos, uno ya muerto. Con la referencia, entre la lectura y la marca no
   * se puede colar nada.
   *
   * Es la misma disciplina que ya usan `InvitePortalUserDialog` —el diálogo
   * hermano de esta misma pantalla— y `PortalAcceptInvitationPage`. Dos
   * ficheros de la misma tarea no pueden tener dos criterios para el mismo
   * problema.
   */
  const enVuelo = useRef<Set<string>>(new Set());
  /**
   * Copia en estado, y **solo para pintar**: deshabilitar el botón es cortesía
   * visual, no la defensa. La decisión de dejar pasar o no la toma `enVuelo`.
   */
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());

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

  const withBusy = (espacio: Espacio, id: number, run: () => Promise<unknown>) => {
    const clave = claveDe(espacio, id);
    // La guarda, antes que nada y sin ningún `await` por delante: entre esta
    // línea y la siguiente no puede colarse otro clic.
    if (enVuelo.current.has(clave)) return;
    enVuelo.current.add(clave);

    setError(null);
    setBusyKeys((prev) => new Set(prev).add(clave));
    run()
      .then(() => load())
      .catch((e) => setError(e?.response?.data?.message ?? 'No se pudo completar la acción. Inténtalo de nuevo.'))
      .finally(() => {
        // En el `finally` para que un fallo no deje la fila bloqueada para
        // siempre: hay que poder reintentar.
        enVuelo.current.delete(clave);
        setBusyKeys((prev) => {
          const next = new Set(prev);
          next.delete(clave);
          return next;
        });
      });
  };

  const deactivate = (m: PortalTeamMember) =>
    withBusy('usuario', m.id, () => portalApi.deactivateTeamMember(m.id));

  // En su propio espacio, no compartiendo numeración con `team`: los ids de
  // las dos tablas son secuencias independientes y se repiten. Ver `Espacio`.
  const resend = (i: PortalInvitation) =>
    withBusy('invitacion', i.id, () => portalApi.resendInvitation(i.id));

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
                    disabled={busyKeys.has(claveDe('invitacion', i.id))}
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
                      disabled={busyKeys.has(claveDe('usuario', m.id))}
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
