import { useEffect, useRef } from 'react';

import { audienceSentence, VISIBILITY_SKINS } from './message-visibility';

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
 * quedar**, con los colores y la etiqueta de una respuesta pública, y el nombre
 * de quien lo va a abrir. Un «esto lo rompió el becario» escrito creyendo que
 * era privado se lee distinto debajo de un cartel que dice quién lo leerá.
 *
 * El foco entra en **Cancelar**: así la tecla Intro, que es la que se pulsa sin
 * mirar, no manda nada.
 */
interface PublicReplyDialogProps {
  open: boolean;
  /** El texto tal cual, sin recortar: se enseña entero. */
  bodyMd: string;
  attachmentCount: number;
  clientName: string | null;
  /** Verdadero mientras el envío está en vuelo. */
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function PublicReplyDialog({
  open,
  bodyMd,
  attachmentCount,
  clientName,
  submitting,
  onCancel,
  onConfirm,
}: PublicReplyDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Escape cierra, como en el resto de los diálogos del panel. No mientras el
  // envío está en vuelo: cerrar entonces daría a entender que se ha cancelado
  // algo que ya va de camino.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, submitting, onCancel]);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
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
            {submitting ? 'Enviando…' : 'Sí, enviar al cliente'}
          </button>
        </div>
      </div>
    </div>
  );
}
