import { useEffect, useState } from 'react';

import { clientUsersApi } from '../../api/client-users.api';
import { Button } from '../../components/ui/Button';
import { toast } from '../../ui/Toast';
import { toErrorList } from './error-list';

interface Props {
  open: boolean;
  /** Cliente elegido en la página; `null` mientras no haya ninguno seleccionado. */
  clientId: number | null;
  clientName: string;
  onCancel: () => void;
  /**
   * Se llama justo después del alta, con el diálogo todavía abierto: la
   * página usa esto para refrescar el listado en segundo plano mientras el
   * diálogo muestra las credenciales. No lo cierra — eso lo decide quien dio
   * de alta, pulsando "Cerrar" (o Escape / clic fuera), una vez que copió lo
   * que necesitaba.
   */
  onCreated: () => void;
}

const MIN_PASSWORD_LENGTH = 8;

async function copyToClipboard(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copiado al portapapeles`);
  } catch (e) {
    console.error('[NewClientUserDialog] No se pudo copiar al portapapeles.', e);
    toast.error(`No se pudo copiar ${label.toLowerCase()}. Cópialo manualmente.`);
  }
}

export default function NewClientUserDialog({ open, clientId, clientName, onCancel, onCreated }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const [busy, setBusy] = useState(false);
  // Lista y no cadena: un 400 de validación puede traer varios motivos a la
  // vez (mismo criterio que NewPortalTicketDialog).
  const [errors, setErrors] = useState<string[]>([]);
  // Credenciales recién creadas, solo en memoria de este diálogo: el backend
  // nunca las devuelve tras el alta ni las vuelve a exponer después, así que
  // esta es la única oportunidad de comunicarlas. No se guardan en ningún
  // otro sitio (ni caché de queries, ni localStorage).
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  // Resetea el formulario cada vez que el diálogo se abre; se mantiene
  // montado para no perder el listener de Escape entre aperturas (mismo
  // patrón que NewPortalTicketDialog / NewTicketDialog).
  useEffect(() => {
    if (!open) return;
    setEmail('');
    setPassword('');
    setFullName('');
    setIsAdmin(false);
    setBusy(false);
    setErrors([]);
    setCreated(null);
  }, [open]);

  // Cerrar con Escape — mismo idioma que el resto de diálogos del panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const canSubmit =
    clientId !== null &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    fullName.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || clientId === null) {
      setErrors(['Completa el correo, el nombre y una contraseña de al menos 8 caracteres.']);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      await clientUsersApi.create({
        clientId,
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        isAdmin,
      });
      // Fallo de escritura vs. fallo de refresco: si esto no lanza, el
      // usuario SÍ se creó. `onCreated` solo refresca el listado; que ese
      // refresco falle no debe leerse como que el alta falló.
      setCreated({ email: email.trim(), password });
      onCreated();
    } catch (e: any) {
      // Fallo de escritura real: el usuario NO se creó. Se muestra en el
      // propio diálogo, con lo ya escrito intacto, para poder reintentar sin
      // volver a teclear nada (incluye el 409 de correo duplicado, legible
      // en español tal como lo manda el backend).
      setErrors(toErrorList(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-client-user-title"
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      style={{ paddingTop: '6vh' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-pop"
      >
        {created ? (
          <>
            <h2 id="new-client-user-title" className="text-lg font-semibold text-slate-900">
              Usuario creado
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Comparte estas credenciales con la persona por un canal seguro. No se guardan en
              ningún lado y no se van a volver a mostrar: si se pierden, la única forma de
              recuperarlas es restablecer la contraseña editando el usuario.
            </p>

            <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <CredentialRow label="Correo" value={created.email} />
              <CredentialRow label="Contraseña" value={created.password} />
            </div>

            <div className="mt-6 flex justify-end">
              <Button type="button" variant="primary" onClick={onCancel}>
                Cerrar
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 id="new-client-user-title" className="text-lg font-semibold text-slate-900">
              Nuevo usuario del portal
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Para <span className="font-medium text-slate-700">{clientName}</span>. La empresa no
              se puede cambiar después de crear el usuario.
            </p>

            {errors.length > 0 && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {errors.length === 1 ? (
                  errors[0]
                ) : (
                  <ul className="list-disc space-y-1 pl-5">
                    {errors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-4 space-y-4">
              <div>
                <label className="label" htmlFor="new-client-user-fullname">
                  Nombre completo *
                </label>
                <input
                  id="new-client-user-fullname"
                  className="input"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nombre y apellido de la persona"
                />
              </div>

              <div>
                <label className="label" htmlFor="new-client-user-email">
                  Correo *
                </label>
                <input
                  id="new-client-user-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="persona@cliente.com"
                />
              </div>

              <div>
                <label className="label" htmlFor="new-client-user-password">
                  Contraseña inicial *
                </label>
                <input
                  id="new-client-user-password"
                  className="input font-mono"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Se muestra en claro porque hay que comunicarla; no se guarda en ningún sitio.
                </p>
              </div>

              <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-300 bg-white w-fit">
                <input
                  type="checkbox"
                  checked={isAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                />
                <span className="text-xs text-slate-600">
                  Administrador de la empresa (reservado, sin efecto todavía)
                </span>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={submit}
                disabled={busy || !canSubmit}
                loading={busy}
              >
                {busy ? 'Creando…' : 'Crear usuario'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="font-mono text-sm text-slate-900 break-all">{value}</p>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => copyToClipboard(value, label)}
        className="flex-shrink-0"
      >
        Copiar
      </Button>
    </div>
  );
}
