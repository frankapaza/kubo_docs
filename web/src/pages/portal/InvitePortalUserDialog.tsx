import { useEffect, useRef, useState } from 'react';

import {
  portalApi,
  PORTAL_INVITE_EMAIL_MAX_LENGTH,
  PORTAL_INVITE_NAME_MAX_LENGTH,
} from '../../api/portal.api';
import type { PortalInvitation } from '../../api/types';
import { Button } from '../../components/ui/Button';

interface Props {
  open: boolean;
  onCancel: () => void;
  onInvited: (invitation: PortalInvitation) => void;
}

/**
 * Cuerpo de error de la API: mismo formato que en los otros diálogos del
 * portal -- `{ code, message }`, y en los 400 de validación también
 * `details` con un motivo por entrada--, así que el mismo criterio para
 * desglosarlo en viñetas.
 *
 * A propósito NO se interpreta ni se adorna `message`: los rechazos de esta
 * ruta en concreto son deliberadamente genéricos (no dicen si el correo ya
 * existe) y esta función los muestra tal cual responde el servidor.
 */
function toErrorList(e: any): string[] {
  const data = e?.response?.data as { message?: string; details?: unknown } | undefined;

  if (Array.isArray(data?.details) && data.details.length > 0) {
    return data.details.map(String);
  }
  if (typeof data?.message === 'string' && data.message.length > 0) {
    return [data.message];
  }
  return ['No se pudo enviar la invitación. Inténtalo de nuevo.'];
}

export default function InvitePortalUserDialog({ open, onCancel, onInvited }: Props) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');

  const [busy, setBusy] = useState(false);
  // Lista y no cadena: un 400 de validación puede traer varios motivos a la
  // vez, igual que en `NewPortalRequirementDialog`.
  const [errors, setErrors] = useState<string[]>([]);

  /**
   * Corta el camino tardío tras desmontar: entre el alta y su respuesta el
   * cliente puede haber navegado a otra pantalla. Mismo motivo que en los
   * otros diálogos del portal.
   */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Freno **síncrono** al doble envío, marcado antes de cualquier `await`. Un
   * segundo clic puede pasar antes de que `busy` --estado asíncrono-- llegue
   * a deshabilitar el botón, y aquí eso significaría dos invitaciones: la
   * segunda revocaría a la primera y la persona recibiría dos correos, uno de
   * ellos ya inservible.
   */
  const inFlight = useRef(false);

  // Resetea el formulario cada vez que el diálogo se abre; se mantiene
  // montado (mismo patrón que los otros diálogos del portal) para no perder
  // el listener de Escape entre aperturas.
  useEffect(() => {
    if (!open) return;
    setFullName('');
    setEmail('');
    setErrors([]);
    setBusy(false);
    inFlight.current = false;
  }, [open]);

  const dismiss = () => {
    if (busy) return;
    onCancel();
  };

  // Cerrar con Escape -- mismo idioma que los demás diálogos del portal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // `busy` y `onCancel` son los que mira `dismiss`: sin ellos el oyente se
    // quedaría con la decisión que era correcta cuando se montó.
  }, [open, busy, onCancel]);

  if (!open) return null;

  // Guarda de vida: un nombre de solo espacios no debe poder enviarse, aunque
  // `length` lo cuente como si tuviera contenido. Mismo motivo que en
  // `NewPortalRequirementDialog`.
  const canSubmit = fullName.trim().length > 0 && email.trim().length > 0;

  const submit = async () => {
    // La guarda, antes que nada y sin ningún `await` por delante: entre esta
    // línea y la siguiente no puede colarse otro clic.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await invite();
    } finally {
      // En el `finally` para que un fallo no deje el diálogo bloqueado para
      // siempre: el cliente tiene que poder reintentar.
      inFlight.current = false;
    }
  };

  const invite = async () => {
    if (!canSubmit) {
      setErrors(['El nombre y el correo son obligatorios.']);
      return;
    }

    setBusy(true);
    // Se limpia el error anterior en el mismo intento que dispara el envío:
    // si un reintento con éxito deja el mensaje de la vez anterior a la
    // vista, el administrador no ve la confirmación y podría volver a pulsar
    // "Enviar invitación" -- dos invitaciones en vez de una.
    setErrors([]);

    try {
      const invitation = await portalApi.invite({
        email: email.trim(),
        fullName: fullName.trim(),
      });
      if (!alive.current) return;
      setBusy(false);
      onInvited(invitation);
    } catch (e: any) {
      if (alive.current) {
        setErrors(toErrorList(e));
        setBusy(false);
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-portal-user-title"
      onClick={dismiss}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      style={{ paddingTop: '6vh' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-pop"
      >
        <h2 id="invite-portal-user-title" className="text-lg font-semibold text-slate-900">
          Invitar a alguien de mi equipo
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Le mandaremos un correo para que elija su propia contraseña. Tú no tienes que teclearla
          ni conocerla.
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
            <label className="label" htmlFor="invite-portal-user-name">
              Nombre y apellidos *
            </label>
            <input
              id="invite-portal-user-name"
              className="input"
              type="text"
              value={fullName}
              maxLength={PORTAL_INVITE_NAME_MAX_LENGTH}
              disabled={busy}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nombre completo de la persona"
            />
          </div>

          <div>
            <label className="label" htmlFor="invite-portal-user-email">
              Correo electrónico *
            </label>
            <input
              id="invite-portal-user-email"
              className="input"
              type="email"
              value={email}
              maxLength={PORTAL_INVITE_EMAIL_MAX_LENGTH}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@empresa.com"
            />
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
            {busy ? 'Enviando…' : 'Enviar invitación'}
          </Button>
        </div>
      </div>
    </div>
  );
}
