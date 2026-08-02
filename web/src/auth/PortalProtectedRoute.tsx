import { Navigate, Outlet } from 'react-router-dom';
import { usePortalAuth } from './PortalAuthContext';

/**
 * Guard de sesión del portal, análogo a `ProtectedRoute` pero sobre
 * `usePortalAuth`: no puede leer la sesión interna ni el guard interno puede
 * leer esta, son contextos y almacenamientos independientes.
 */
export function PortalProtectedRoute() {
  const { clientUser, loading } = usePortalAuth();
  if (loading) return <div className="p-8 text-slate-500">Cargando…</div>;
  if (!clientUser) return <Navigate to="/portal/login" replace />;
  return <Outlet />;
}
