import { useEffect, useState } from 'react';

import { clientUsersApi, type ClientUser } from '../../api/client-users.api';
import { Button } from '../../components/ui/Button';
import { toErrorList } from './error-list';

interface Props {
  open: boolean;
  user: ClientUser | null;
  onCancel: () => void;
  onUpdated: () => void;
}

const MIN_PASSWORD_LENGTH = 8;

/**
 * Edita un usuario de cliente ya existente. Deliberadamente sin ningún campo
 * ni selector de empresa: `UpdateClientUserDto` no admite `clientId` — moverlo
 * de empresa es borrar y crear de nuevo, no un PATCH — y esta pantalla no debe
 * insinuar lo contrario ni siquiera mostrándolo como texto editable.
 */
export default function EditClientUserDialog({ open, user, onCancel, onUpdated }: Props) {
  const [fullName, setFullName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [resetPassword, setResetPassword] = useState(false);
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Repone los campos desde el usuario cada vez que el diálogo se abre (o
  // cambia el usuario editado); se mantiene montado para no perder el
  // listener de Escape entre aperturas.
  useEffect(() => {
    if (!open || !user) return;
    setFullName(user.fullName);
    setIsActive(user.isActive);
    setIsAdmin(user.isAdmin);
    setResetPassword(false);
    setPassword('');
    setBusy(false);
    setErrors([]);
  }, [open, user]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open || !user) return null;

  const canSubmit =
    fullName.trim().length > 0 && (!resetPassword || password.length >= MIN_PASSWORD_LENGTH);

  const submit = async () => {
    if (!canSubmit) {
      setErrors(
        resetPassword
          ? ['La nueva contraseña debe tener al menos 8 caracteres.']
          : ['El nombre completo es obligatorio.'],
      );
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      await clientUsersApi.update(user.id, {
        fullName: fullName.trim(),
        isActive,
        isAdmin,
        ...(resetPassword ? { password } : {}),
      });
      onUpdated();
    } catch (e: any) {
      // Fallo de escritura: los cambios NO se guardaron. Se muestra en el
      // propio diálogo, con lo editado intacto, para poder reintentar.
      setErrors(toErrorList(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-client-user-title"
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      style={{ paddingTop: '6vh' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-pop"
      >
        <h2 id="edit-client-user-title" className="text-lg font-semibold text-slate-900">
          Editar usuario del portal
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {user.email}{' '}
          <span className="text-slate-400">— la empresa de un usuario no se puede cambiar.</span>
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
            <label className="label" htmlFor="edit-client-user-fullname">
              Nombre completo *
            </label>
            <input
              id="edit-client-user-fullname"
              className="input"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-300 bg-white">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span className="text-xs text-slate-600">Cuenta activa</span>
            </label>
            <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-300 bg-white">
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

          <div className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={resetPassword}
                onChange={(e) => {
                  setResetPassword(e.target.checked);
                  if (!e.target.checked) setPassword('');
                }}
              />
              <span className="text-xs font-medium text-slate-700">Restablecer contraseña</span>
            </label>
            {resetPassword && (
              <div className="mt-3">
                <label className="label" htmlFor="edit-client-user-password">
                  Nueva contraseña *
                </label>
                <input
                  id="edit-client-user-password"
                  className="input font-mono"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Vuelve a comunicarla tú mismo: el backend no la reenvía ni la muestra en ningún
                  otro sitio.
                </p>
              </div>
            )}
          </div>
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
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </div>
    </div>
  );
}
