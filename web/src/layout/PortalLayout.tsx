import { Outlet, useNavigate } from 'react-router-dom';
import { usePortalAuth } from '../auth/PortalAuthContext';
import { KuboLogo, LogOutIcon } from '../components/ui/Icon';

/**
 * Cabecera mínima del portal de clientes: nombre de la empresa (el que haya
 * disponible) y salir. Sin menú lateral interno a propósito — un cliente no
 * debe ver ni siquiera los nombres de las secciones internas del panel, así
 * que este layout no comparte nada visual con `AppLayout`.
 */
export default function PortalLayout() {
  const { clientUser, logout } = usePortalAuth();
  const navigate = useNavigate();

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
                El login del portal (`portal-auth.service.ts`) devuelve `clientUser`
                con `id`, `email`, `fullName` y `clientId`, pero no la razón social
                del cliente: no hay endpoint que la exponga. Mostramos el nombre del
                usuario en su lugar en vez de inventar el de la empresa o añadir un
                endpoint nuevo (fuera del alcance de esta tarea).
              */}
              <p className="text-xs text-slate-500 mt-1 truncate">
                {clientUser?.fullName ?? ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition flex-shrink-0"
          >
            <LogOutIcon size={16} />
            Salir
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
