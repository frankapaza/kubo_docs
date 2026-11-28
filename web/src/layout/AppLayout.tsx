import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import MissingSystemsBanner from './MissingSystemsBanner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { useIdleLogout } from '../auth/useIdleLogout';
import { canManageLogInstallations, canManageUsers, canUseDevKeys } from '../auth/permissions';
import { monitoringApi } from '../api/monitoring.api';
import { useRealtime } from '../lib/realtime';
import { workspaceApi } from '../api/workspace.api';
import { roleLabels } from '../components/ui/Badge';
import { ArchiveIcon, BellIcon, ClockIcon, RefreshIcon, BookOpenIcon, FileTextIcon, FolderIcon, InboxIcon, KuboLogo, LogOutIcon, SettingsIcon, SparklesIcon, UsersIcon, ZapIcon } from '../components/ui/Icon';
// Nota: "InboxIcon" también se usa en la sección Tickets (nav principal); es intencional.
import { toast } from '../ui/Toast';
import { useNewTicketNotifier } from '../pages/tickets/useNewTicketNotifier';
import { useNewErrorNotifier } from '../pages/monitoring/useNewErrorNotifier';
import NotificationPermissionBanner from './NotificationPermissionBanner';
// Nota: "UsersIcon" también se usa en la sección Clientes; es intencional.

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useNewTicketNotifier();
  useNewErrorNotifier();
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Menú lateral plegable en pantallas angostas (iPad vertical, < 1024 px).
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [location.pathname]);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Config de sesión desde workspace (admin la edita)
  const { data: ws } = useQuery({
    queryKey: ['workspace-settings'],
    queryFn: workspaceApi.get,
    staleTime: 60_000,
  });
  const sessionTimeout = ws?.sessionTimeoutMinutes ?? 0;

  // Errores nuevos sin atender, para la insignia del menú. Se recarga cuando
  // el servidor avisa que la lista cambió.
  const { data: errorsSummary } = useQuery({
    queryKey: ['monitoring-errors-summary'],
    queryFn: monitoringApi.errorsSummary,
    staleTime: 30_000,
  });
  const onErrorsChanged = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['monitoring-errors-summary'] });
  }, [queryClient]);
  useRealtime('errors:changed', onErrorsChanged);

  // En la página de grabación no aplicamos idle logout: el usuario está en otra pestaña
  const isRecorderPage = /^\/meetings\/\d+\/record-web/.test(location.pathname);
  const effectiveTimeout = isRecorderPage ? null : sessionTimeout;

  useIdleLogout(effectiveTimeout, () => {
    toast.warning('Sesión cerrada por inactividad');
    logout();
  }, {
    warningSeconds: 30,
    onWarning: () => {
      toast.info('Tu sesión se cerrará en 30 segundos por inactividad. Mueve el mouse para continuar.');
    },
  });

  useEffect(() => {
    if (!settingsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [settingsOpen]);

  const navItem =
    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition';
  const navActive = 'bg-kubo-nav-active text-white';
  const navIdle = 'text-kubo-nav-text hover:bg-white/5 hover:text-white';

  const initials = (user?.fullName ?? 'U')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const go = (path: string) => {
    setSettingsOpen(false);
    navigate(path);
  };

  return (
    <div className="min-h-screen flex bg-kubo-surface">
      {/* Fondo que cierra el menú desplegado en iPad vertical. */}
      {navOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-kubo-nav flex flex-col overflow-y-auto transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 lg:overflow-visible ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="px-5 py-5 border-b border-white/10">
          <Link to="/" className="flex items-center gap-3">
            <KuboLogo size={32} />
            <div>
              <p className="font-semibold text-white leading-none">Kubo Platform</p>
              <p className="text-xs text-kubo-nav-muted mt-1">Soporte, proyectos y monitoreo</p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
          <p className="px-3 py-1 text-[11px] font-semibold text-kubo-nav-muted uppercase tracking-wider">
            Principal
          </p>
          <NavLink
            to="/clients"
            className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
          >
            <UsersIcon size={18} />
            Clientes
          </NavLink>
          <NavLink
            to="/projects"
            className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
          >
            <FolderIcon size={18} />
            Proyectos
          </NavLink>
          <NavLink
            to="/tickets"
            className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
          >
            <InboxIcon size={18} />
            Tickets
          </NavLink>
          <NavLink
            to="/work-items"
            className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
          >
            <ArchiveIcon size={18} />
            Requerimientos
          </NavLink>

          <p className="px-3 py-1 mt-4 text-[11px] font-semibold text-kubo-nav-muted uppercase tracking-wider">
            Errores de sistema
          </p>
          <NavLink
            to="/monitoreo/errores"
            className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
          >
            <BellIcon size={18} />
            <span className="flex-1">Errores</span>
            {(errorsSummary?.nuevos ?? 0) > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold">
                {errorsSummary!.nuevos}
              </span>
            )}
          </NavLink>
          <NavLink
            to="/monitoreo/logs"
            className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
          >
            <FileTextIcon size={18} />
            Logs
          </NavLink>
          {canManageLogInstallations(user) && (
            <NavLink
              to="/monitoreo/instalaciones"
              className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
            >
              <SettingsIcon size={18} />
              Instalaciones
            </NavLink>
          )}
          {canUseDevKeys(user) && (
            <NavLink
              to="/dev/claves"
              className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
            >
              <ZapIcon size={18} />
              Claves de desarrollo
            </NavLink>
          )}

          <p className="px-3 py-1 mt-4 text-[11px] font-semibold text-kubo-nav-muted uppercase tracking-wider">
            Monitoreo
          </p>
          {([
            ['/monitoreo/estado', 'Estado', ZapIcon],
            ['/monitoreo/incidentes', 'Incidentes', ClockIcon],
            ['/monitoreo/servidores', 'Servidores', ArchiveIcon],
            ['/monitoreo/disponibilidad', 'Disponibilidad', ClockIcon],
            ['/monitoreo/inventario', 'Inventario', ArchiveIcon],
            ['/monitoreo/sondas', 'Sondas', RefreshIcon],
          ] as const).map(([to, label, Icon]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}

          {canManageUsers(user) && (
            <>
              <p className="px-3 py-1 mt-4 text-[11px] font-semibold text-kubo-nav-muted uppercase tracking-wider">
                Administración
              </p>
              <NavLink
                to="/users"
                className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
              >
                <UsersIcon size={18} />
                Usuarios
              </NavLink>
              <NavLink
                to="/admin/client-users"
                className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
              >
                <UsersIcon size={18} />
                Usuarios de clientes
              </NavLink>
            </>
          )}

          {/*
            Sin condición de rol: el manual lo necesita sobre todo quien acaba
            de entrar al equipo, que suele ser DEVELOPER. Va como último grupo
            del menú y no al pie del `aside` con `mt-auto`: el aside crece con
            la página, así que "al pie" queda fuera de pantalla en cualquier
            vista larga.
          */}
          <p className="px-3 py-1 mt-4 text-[11px] font-semibold text-kubo-nav-muted uppercase tracking-wider">
            Ayuda
          </p>
          <NavLink
            to="/help"
            className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
          >
            <BookOpenIcon size={18} />
            Manual del equipo
          </NavLink>
        </nav>

        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg relative" ref={settingsRef}>
            <div className="w-9 h-9 rounded-full bg-kubo-primary text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">
                {user?.fullName ?? 'Usuario'}
              </p>
              <p className="text-xs text-kubo-nav-muted truncate">
                {user?.role ? roleLabels[user.role] : user?.email}
              </p>
            </div>
            {canManageUsers(user) && (
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className={`p-2 rounded-lg transition ${
                  settingsOpen
                    ? 'bg-kubo-nav-active text-white'
                    : 'text-kubo-nav-muted hover:text-white hover:bg-white/10'
                }`}
                title="Configuración"
              >
                <SettingsIcon size={16} />
              </button>
            )}
            <button
              onClick={logout}
              className="p-2 rounded-lg text-kubo-nav-muted hover:text-white hover:bg-white/10 transition"
              title="Salir"
            >
              <LogOutIcon size={16} />
            </button>

            {settingsOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-20">
                <p className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Configuración
                </p>
                <button
                  onClick={() => go('/admin/ai-providers')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition text-left"
                >
                  <SparklesIcon size={15} className="text-slate-500" />
                  Proveedores IA
                </button>
                <button
                  onClick={() => go('/admin/integrations')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition text-left"
                >
                  <ZapIcon size={15} className="text-slate-500" />
                  Integraciones
                </button>
                {/*
                  Aquí y no en el menú principal: es mantenimiento de una lista
                  que se toca cada varios meses. El desplegable entero ya está
                  detrás de `canManageUsers`, la misma condición que
                  `canManageSystemCatalog`.
                */}
                <button
                  onClick={() => go('/admin/sistemas')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition text-left"
                >
                  <SettingsIcon size={15} className="text-slate-500" />
                  Catálogo de sistemas
                </button>
                <button
                  onClick={() => go('/admin/templates')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition text-left"
                >
                  <FileTextIcon size={15} className="text-slate-500" />
                  Plantillas de documentos
                </button>
                <button
                  onClick={() => go('/admin/notifications')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition text-left"
                >
                  <BellIcon size={15} className="text-slate-500" />
                  Notificaciones por correo
                </button>
                <button
                  onClick={() => go('/admin/alertas-monitoreo')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition text-left"
                >
                  <BellIcon size={15} className="text-slate-500" />
                  Alertas de monitoreo
                </button>
                <button
                  onClick={() => go('/admin/workspace')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition text-left"
                >
                  <FileTextIcon size={15} className="text-slate-500" />
                  Datos del emisor
                </button>
                <button
                  onClick={() => go('/admin/correo-entrante')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition text-left"
                >
                  <InboxIcon size={15} className="text-slate-500" />
                  Correo entrante
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        {/* Barra superior solo en pantallas angostas: abre el menú. */}
        <div className="lg:hidden sticky top-0 z-20 flex items-center gap-3 bg-kubo-nav px-4 py-3 text-white" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Abrir menú"
            className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-white/10"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <KuboLogo size={26} />
          <span className="font-semibold">Kubo Platform</span>
        </div>
        {/*
         * Sin tope de ancho: este panel es de tablas -- la mesa de servicio
         * tiene ocho columnas, y la ficha de cliente, pestanas con listados.
         * Con `max-w-6xl` (1152px) el contenido se quedaba en una columna
         * estrecha y el resto de una pantalla ancha era espacio muerto.
         *
         * El portal del cliente SI conserva su tope (`max-w-5xl`), y es a
         * proposito: alli lo que manda es texto -- la conversacion de un
         * ticket -- y una linea de texto demasiado larga se lee peor, porque
         * el ojo pierde el salto de renglon.
         */}
        <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <NotificationPermissionBanner />
          <MissingSystemsBanner />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
