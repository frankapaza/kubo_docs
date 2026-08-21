import { useEffect, useRef, useState } from 'react';

import {
  portalApi,
  PORTAL_REQUIREMENT_TITLE_MAX_LENGTH,
  PORTAL_REQUIREMENT_DESCRIPTION_MAX_LENGTH,
} from '../../api/portal.api';
import type { PortalRequirement } from '../../api/types';
import { Button } from '../../components/ui/Button';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreated: (requirement: PortalRequirement) => void;
}

/**
 * Cuerpo de error de la API: mismo formato que en `NewPortalTicketDialog` --
 * `{ code, message }`, y en los 400 de validación también `details` con un
 * motivo por entrada--, así que el mismo criterio para desglosarlo en viñetas.
 */
function toErrorList(e: any): string[] {
  const data = e?.response?.data as { message?: string; details?: unknown } | undefined;

  if (Array.isArray(data?.details) && data.details.length > 0) {
    return data.details.map(String);
  }
  if (typeof data?.message === 'string' && data.message.length > 0) {
    return [data.message];
  }
  return ['No se pudo crear el requerimiento. Inténtalo de nuevo.'];
}

export default function NewPortalRequirementDialog({ open, onCancel, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [busy, setBusy] = useState(false);
  // Lista y no cadena: un 400 de validación puede traer varios motivos a la
  // vez, igual que en `NewPortalTicketDialog`.
  const [errors, setErrors] = useState<string[]>([]);

  /**
   * Corta el camino tardío tras desmontar: entre el alta y su respuesta el
   * cliente puede haber navegado a otra pantalla. Mismo motivo que en
   * `NewPortalTicketDialog`.
   */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Guarda **síncrona** contra el doble envío, marcada antes de cualquier
   * `await` y nunca desde un `useEffect`.
   *
   * Este defecto ya se coló dos veces en este mismo proyecto y produjo altas
   * duplicadas de verdad: un segundo clic que pasa antes de que `busy`
   * (estado asíncrono, se aplica en el siguiente render) llegue a
   * deshabilitar el botón. Un `ref` se escribe y se lee en el mismo tick y no
   * depende de cuándo React decida repintar.
   */
  const inFlight = useRef(false);

  // Resetea el formulario cada vez que el diálogo se abre; se mantiene
  // montado (mismo patrón que `NewPortalTicketDialog`) para no perder el
  // listener de Escape entre aperturas.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setErrors([]);
    setBusy(false);
  }, [open]);

  const dismiss = () => {
    if (busy) return;
    onCancel();
  };

  // Cerrar con Escape — mismo idioma que los demás diálogos del portal.
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

  // Guarda de vida: un título o una descripción de solo espacios no deben
  // poder enviarse, aunque `length` los cuente como si tuvieran contenido.
  const canSubmit = title.trim().length > 0 && description.trim().length > 0;

  const submit = async () => {
    // La guarda, antes que nada y sin ningún `await` por delante: entre esta
    // línea y la siguiente no puede colarse otro clic.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await create();
    } finally {
      // En el `finally` para que un fallo no deje el diálogo bloqueado para
      // siempre: el cliente tiene que poder reintentar.
      inFlight.current = false;
    }
  };

  const create = async () => {
    if (!canSubmit) {
      setErrors(['El título y la descripción son obligatorios.']);
      return;
    }

    setBusy(true);
    // Se limpia el error anterior en el mismo intento que dispara el envío,
    // y no solo en uno de los dos botones: si un reintento con éxito deja el
    // mensaje de la vez anterior a la vista, el cliente no ve la
    // confirmación, cree que no se creó y vuelve a pulsar "Crear" -- dos
    // requerimientos idénticos en vez de uno.
    setErrors([]);

    try {
      const created = await portalApi.createRequirement({
        title: title.trim(),
        descriptionMd: description.trim(),
      });
      if (!alive.current) return;
      setBusy(false);
      onCreated(created);
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
      aria-labelledby="new-portal-requirement-title"
      onClick={dismiss}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      style={{ paddingTop: '6vh' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-pop"
      >
        <h2 id="new-portal-requirement-title" className="text-lg font-semibold text-slate-900">
          Pedir un requerimiento
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Cuéntanos qué necesitas construir; nuestro equipo lo revisará y te dirá cuándo se compromete.
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
            <label className="label" htmlFor="portal-requirement-title">
              Título *
            </label>
            <input
              id="portal-requirement-title"
              className="input"
              type="text"
              value={title}
              maxLength={PORTAL_REQUIREMENT_TITLE_MAX_LENGTH}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Resumen breve de lo que necesitas"
            />
            <p className="mt-1 text-right text-xs text-slate-400">
              {title.length}/{PORTAL_REQUIREMENT_TITLE_MAX_LENGTH}
            </p>
          </div>

          <div>
            <label className="label" htmlFor="portal-requirement-description">
              Descripción *
            </label>
            <textarea
              id="portal-requirement-description"
              className="input"
              rows={6}
              value={description}
              maxLength={PORTAL_REQUIREMENT_DESCRIPTION_MAX_LENGTH}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe con el mayor detalle posible qué necesitas y para qué"
            />
            <p className="mt-1 text-right text-xs text-slate-400">
              {description.length}/{PORTAL_REQUIREMENT_DESCRIPTION_MAX_LENGTH}
            </p>
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
            {busy ? 'Enviando…' : 'Enviar requerimiento'}
          </Button>
        </div>
      </div>
    </div>
  );
}
