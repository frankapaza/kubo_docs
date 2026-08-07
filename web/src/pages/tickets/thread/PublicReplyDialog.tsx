import { useEffect, useRef } from 'react';

import { audienceSentence, VISIBILITY_SKINS } from './message-visibility';
import type { PostFailure } from './post-failure';

/**
 * El último control antes de que un mensaje salga hacia el cliente.
 *
 * **Por qué solo confirma la respuesta pública y no la nota interna.** Poner el
 * mismo diálogo en los dos caminos parece más prudente y es peor: el gesto
 * «pulsar y confirmar» se convierte en un reflejo de dos clics que se ejecuta
 * igual de rápido en el camino peligroso que en el inocuo, y entonces el
 * diálogo ya no lo lee nadie. Aquí la fricción es **asimétrica a propósito**:
 * la nota interna --que no sale de Kubo y no se puede convertir en un daño-- se
 * manda de un clic, y el único camino que no tiene marcha atrás cuesta uno más.
 * De paso, el camino barato es el seguro, que es como debe ser cuando alguien
 * va con prisa.
 *
 * Lo que enseña no es un «¿Estás seguro?»: es **el mensaje tal y como va a
 * quedar** --el cuerpo ya recortado, que es exactamente el que se publica--,
 * con los colores y la etiqueta de una respuesta pública, y el nombre de quien
 * lo va a abrir.
 *
 * **El error del envío sale aquí dentro, no detrás.** Antes se escribía en el
 * compositor, que en ese momento está tapado por este modal: el envío fallaba,
 * el diálogo seguía abierto sin decir una palabra y con el botón rehabilitado.
 * Eso enseña justo el reflejo de doble clic que la asimetría quiere evitar --y
 * la asimetría solo vale mientras confirmar sea un acto que se lee.
 *
 * El foco entra en **Cancelar** (así la tecla Intro, que es la que se pulsa sin
 * mirar, no manda nada), **no se sale del diálogo con el tabulador** y **vuelve
 * al elemento de antes** al cerrarse.
 */
interface PublicReplyDialogProps {
  open: boolean;
  /** El cuerpo **ya recortado**: el mismo que va a viajar en la petición. */
  bodyMd: string;
  attachmentCount: number;
  clientName: string | null;
  /** Verdadero mientras el envío está en vuelo. */
  submitting: boolean;
  /** Lo que falló al enviar, si falló. Se enseña aquí dentro. */
  error: PostFailure | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Lo que puede recibir el foco dentro del diálogo. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function PublicReplyDialog({
  open,
  bodyMd,
  attachmentCount,
  clientName,
  submitting,
  error,
  onCancel,
  onConfirm,
}: PublicReplyDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  /** Quién tenía el foco antes de abrir, para devolvérselo al cerrar. */
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Escape cierra, como en el resto de los diálogos del panel; y el tabulador
  // da la vuelta dentro del diálogo en vez de irse a los botones de detrás,
  // que están tapados y no se pueden ver mientras hay un modal delante.
  //
  // Ninguna de las dos cosas ocurre mientras el envío está en vuelo: cerrar
  // entonces daría a entender que se ha cancelado algo que ya va de camino. Esa
  // ventana está acotada por el tiempo de espera del compositor, así que no
  // puede quedarse abierta para siempre.
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!submitting) onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        // Todo deshabilitado (envío en vuelo): el foco se queda donde está en
        // vez de escaparse detrás del modal.
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, submitting, onCancel]);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    return () => {
      // Devolver el foco es lo que evita que, al cerrar, quien navega con
      // teclado aparezca al principio del documento sin saber dónde está.
      previouslyFocused.current?.focus?.();
      previouslyFocused.current = null;
    };
  }, [open]);

  if (!open) return null;

  const skin = VISIBILITY_SKINS.PUBLICA;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="public-reply-dialog-title"
      onClick={() => {
        if (!submitting) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
    >
      <div
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-[620px] max-w-[94vw] flex-col gap-4 overflow-y-auto rounded-xl bg-white p-6 shadow-pop"
      >
        <h2 id="public-reply-dialog-title" className="text-base font-semibold text-slate-900">
          Vas a responder al cliente
        </h2>

        <p className={`rounded-lg px-3 py-2 text-[13px] font-medium ${skin.noticeClass}`}>
          {audienceSentence('PUBLICA', clientName)}
        </p>

        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-500">
            Así queda en el hilo y esto es lo que se publica:
          </p>
          <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white pl-4 pr-3 py-3">
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1.5"
              style={skin.railStyle}
            />
            <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${skin.chipClass}`}>
              {skin.chip}
            </span>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">
              {bodyMd}
            </p>
            {attachmentCount > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Con {attachmentCount} {attachmentCount === 1 ? 'archivo adjunto' : 'archivos adjuntos'}
                , que el cliente también podrá descargar.
              </p>
            )}
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-800"
          >
            <strong className="font-semibold">{error.headline}</strong> {error.detail}
          </p>
        )}

        <p className="text-xs text-slate-500">
          ¿Era una nota para el equipo? Cancela y usa el botón ámbar «
          {VISIBILITY_SKINS.INTERNA.action}».
        </p>

        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className={`h-10 rounded-lg px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${skin.buttonClass}`}
          >
            {submitting ? 'Enviando…' : error ? 'Reintentar el envío' : 'Sí, enviar al cliente'}
          </button>
        </div>
      </div>
    </div>
  );
}
