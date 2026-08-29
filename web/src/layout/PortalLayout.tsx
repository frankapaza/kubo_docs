import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { usePortalAuth } from '../auth/PortalAuthContext';
import { BookOpenIcon, KuboLogo, LogOutIcon } from '../components/ui/Icon';

/**
 * Cabecera mínima del portal de clientes: nombre de la empresa (el que haya
 * disponible) y salir. Sin menú lateral interno a propósito — un cliente no
 * debe ver ni siquiera los nombres de las secciones internas del panel, así
 * que este layout no comparte nada visual con `AppLayout`.
 */
export default function PortalLayout() {
  const { clientUser, logout } = usePortalAuth();
  const navigate = useNavigate();

  // Si el backend no pudo resolver la razón social (`clientRazonSocial` nulo
  // o vacío), se cae al nombre del usuario en vez de dejar la cabecera vacía.
  const headerName = clientUser?.clientRazonSocial || clientUser?.fullName || '';

  const onLogout = () => {
    logout();
    navigate('/portal/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-kubo-surface">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <KuboLogo size={28} />
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 leading-none truncate">
                Portal de clientes
              </p>
              {/*
                `clientRazonSocial` viene de `portal-auth.service.ts` (login y
                refresh), resuelto vía `ClientsService.findByIdOrFail`. Si llega
                vacío o nulo, se muestra el nombre del usuario en su lugar en vez
                de dejar la cabecera en blanco.
              */}
              <p className="text-xs text-slate-500 mt-1 truncate">{headerName}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            {/*
              Navegación entre las dos secciones del portal, más la ayuda:
              todo lo que el cliente tiene siempre a la vista, aquí en la
              cabecera y no en un menú lateral (ver el comentario de arriba).
              `NavLink` y no `Link` para que se distinga en cuál sección estás.
            */}
            <NavLink
              to="/portal/tickets"
              className={({ isActive }) =>
                `text-sm font-medium transition ${
                  isActive ? 'text-kubo-primary' : 'text-slate-600 hover:text-slate-900'
                }`
              }
            >
              Tickets
            </NavLink>
            <NavLink
              to="/portal/requerimientos"
              className={({ isActive }) =>
                `text-sm font-medium transition ${
                  isActive ? 'text-kubo-primary' : 'text-slate-600 hover:text-slate-900'
                }`
              }
            >
              Requerimientos
            </NavLink>
            <NavLink
              to="/portal/informes"
              className={({ isActive }) =>
                `text-sm font-medium transition ${
                  isActive ? 'text-kubo-primary' : 'text-slate-600 hover:text-slate-900'
                }`
              }
            >
              Informes
            </NavLink>
            {/*
              Solo para quien administra su empresa. `isAdmin` viene del
              backend (`portal-auth.service.ts`, `!!user.isAdmin`), no de una
              suposición del navegador. Esconder el enlace NO es la defensa: la
              defensa es `ClientAdminGuard`.
            */}
            {clientUser?.isAdmin && (
              <NavLink
                to="/portal/equipo"
                className={({ isActive }) =>
                  `text-sm font-medium transition ${
                    isActive ? 'text-kubo-primary' : 'text-slate-600 hover:text-slate-900'
                  }`
                }
              >
                Mi equipo
              </NavLink>
            )}
            <NavLink
              to="/portal/help"
              className={({ isActive }) =>
                `inline-flex items-center gap-2 text-sm font-medium transition ${
                  isActive ? 'text-kubo-primary' : 'text-slate-600 hover:text-slate-900'
                }`
              }
            >
              <BookOpenIcon size={16} />
              Ayuda
            </NavLink>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition"
            >
              <LogOutIcon size={16} />
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
