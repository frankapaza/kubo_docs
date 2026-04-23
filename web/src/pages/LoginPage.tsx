import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/Button';
import { KuboLogo } from '../components/ui/Icon';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@kubo.pe');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate('/projects');
    } catch {
      setError('Credenciales inválidas');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-emerald-50 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <KuboLogo size={48} />
          <h1 className="text-2xl font-bold text-slate-900 mt-4">Kubo DevDocs</h1>
          <p className="text-sm text-slate-500 mt-1">CRM de reuniones y actas</p>
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
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            {loading ? 'Ingresando…' : 'Ingresar'}
          </Button>

          <p className="text-xs text-center text-slate-500">
            ¿No tienes cuenta?{' '}
            <Link to="/register" className="text-kubo-primary font-medium hover:underline">
              Regístrate
            </Link>
          </p>
        </form>

        <p className="text-xs text-slate-400 text-center mt-6">
          © {new Date().getFullYear()} Kubo DevDocs · Todos los derechos reservados
        </p>
      </div>
    </div>
  );
}
