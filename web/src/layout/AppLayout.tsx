import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { useIdleLogout } from '../auth/useIdleLogout';
import { canManageUsers } from '../auth/permissions';
import { workspaceApi } from '../api/workspace.api';
import { roleLabels } from '../components/ui/Badge';
import { ArchiveIcon, BellIcon, BookOpenIcon, BotIcon, FileTextIcon, FolderIcon, InboxIcon, KuboLogo, LogOutIcon, SettingsIcon, SparklesIcon, UsersIcon, ZapIcon } from '../components/ui/Icon';
// Nota: "InboxIcon" también se usa en la sección Tickets (nav principal); es intencional.
import { toast } from '../ui/Toast';
// Nota: "UsersIcon" también se usa en la sección Clientes; es intencional.

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Config de sesión desde workspace (admin la edita)
  const { data: ws } = useQuery({
    queryKey: ['workspace-settings'],
    queryFn: workspaceApi.get,
    staleTime: 60_000,
  });
  const sessionTimeout = ws?.sessionTimeoutMinutes ?? 0;

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
  const navActive = 'bg-kubo-primary-light text-kubo-primary-dark';
  const navIdle = 'text-slate-600 hover:bg-slate-100';

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
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col">
        <div className="px-5 py-5 border-b border-slate-100">
          <Link to="/" className="flex items-center gap-3">
            <KuboLogo size={32} />
            <div>
              <p className="font-semibold text-slate-900 leading-none">Kubo DevDocs</p>
              <p className="text-xs text-slate-500 mt-1">CRM de reuniones</p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
          <p className="px-3 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
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

          <p className="px-3 py-1 mt-4 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Agentes IA
          </p>
          <NavLink
            to="/agents"
            className={({ isActive }) => `${navItem} ${isActive ? navActive : navIdle}`}
          >
            <BotIcon size={18} />
            Agentes
          </NavLink>

          {canManageUsers(user) && (
            <>
              <p className="px-3 py-1 mt-4 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
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
          <p className="px-3 py-1 mt-4 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
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

        <div className="p-3 border-t border-slate-100">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg relative" ref={settingsRef}>
            <div className="w-9 h-9 rounded-full bg-kubo-primary text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900 truncate">
                {user?.fullName ?? 'Usuario'}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {user?.role ? roleLabels[user.role] : user?.email}
              </p>
            </div>
            {canManageUsers(user) && (
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className={`p-2 rounded-lg transition ${
                  settingsOpen
                    ? 'bg-kubo-primary-light text-kubo-primary-dark'
                    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                }`}
                title="Configuración"
              >
                <SettingsIcon size={16} />
              </button>
            )}
            <button
              onClick={logout}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
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
        <div className="max-w-6xl mx-auto px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
