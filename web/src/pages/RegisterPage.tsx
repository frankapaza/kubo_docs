import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AxiosError } from 'axios';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/Button';
import { KuboLogo } from '../components/ui/Icon';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (form.password !== form.confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    if (form.password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    setLoading(true);
    try {
      await register({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
      });
      navigate('/projects');
    } catch (err: unknown) {
      if (err instanceof AxiosError) {
        const data = err.response?.data as { message?: string | string[] } | undefined;
        const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
        setError(msg ?? 'No se pudo completar el registro');
      } else {
        setError('No se pudo completar el registro');
      }
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
          <p className="text-sm text-slate-500 mt-1">Crea tu cuenta</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-white rounded-2xl shadow-pop border border-slate-100 p-8 space-y-5"
        >
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Registro</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Completa tus datos para empezar
            </p>
          </div>

          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2.5">
            <span className="inline-block px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 text-[10px] font-semibold uppercase tracking-wide flex-shrink-0">
              En desarrollo
            </span>
            <span>
              La verificación por correo electrónico se habilitará en una versión futura. Por ahora tu cuenta se activa al momento.
            </span>
          </div>

          <div>
            <label className="label">Nombre completo</label>
            <input
              className="input"
              type="text"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              placeholder="Ej: Frank Apaza"
              minLength={3}
              required
            />
          </div>

          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="tu@empresa.com"
              required
            />
          </div>

          <div>
            <label className="label">Contraseña</label>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Mínimo 8 caracteres"
              minLength={8}
              required
            />
          </div>

          <div>
            <label className="label">Confirmar contraseña</label>
            <input
              className="input"
              type="password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              placeholder="Repite la contraseña"
              minLength={8}
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            {loading ? 'Creando cuenta…' : 'Crear cuenta'}
          </Button>

          <p className="text-xs text-center text-slate-500">
            ¿Ya tienes cuenta?{' '}
            <Link to="/login" className="text-kubo-primary font-medium hover:underline">
              Inicia sesión
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
