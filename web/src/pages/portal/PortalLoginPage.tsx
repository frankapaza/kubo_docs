import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AxiosError } from 'axios';
import { usePortalAuth } from '../../auth/PortalAuthContext';
import { Button } from '../../components/ui/Button';
import { KuboLogo } from '../../components/ui/Icon';

export default function PortalLoginPage() {
  const { clientUser, loading: sessionLoading, login } = usePortalAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Mientras se resuelve si ya hay sesión de portal guardada, no mostramos nada.
  if (sessionLoading) return null;
  // Sesión de portal ya abierta: no repetir el formulario, ir directo a sus tickets.
  if (clientUser) return <Navigate to="/portal/tickets" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/portal/tickets', { replace: true });
    } catch (err: unknown) {
      if (err instanceof AxiosError) {
        const data = err.response?.data as { message?: string | string[] } | undefined;
        const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
        // El backend usa a propósito el mismo mensaje para correo inexistente,
        // contraseña incorrecta y cuenta desactivada (evita enumerar cuentas
        // dadas de alta); no se distingue ni se "mejora" aquí.
        setError(msg ?? 'No se pudo iniciar sesión');
      } else {
        setError('No se pudo iniciar sesión');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-emerald-50 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <KuboLogo size={48} />
          <h1 className="text-2xl font-bold text-slate-900 mt-4">Portal de clientes</h1>
          <p className="text-sm text-slate-500 mt-1">
            Consulta y crea tus tickets de soporte
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-white rounded-2xl shadow-pop border border-slate-100 p-8 space-y-5"
        >
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Bienvenido</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Ingresa con tu cuenta para continuar
            </p>
          </div>

          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@empresa.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="label">Contraseña</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
            {submitting ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>

        <p className="text-xs text-slate-400 text-center mt-6">
          © {new Date().getFullYear()} Kubo DevDocs · Todos los derechos reservados
        </p>
      </div>
    </div>
  );
}
