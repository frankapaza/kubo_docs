import { ReactNode, useCallback, useEffect, useState } from 'react';

export type ConfirmTone = 'info' | 'warning' | 'danger';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
}

interface ConfirmState extends ConfirmOptions {
  id: string;
  resolve: (value: boolean) => void;
}

// Singleton para llamar desde cualquier módulo
let dispatcher: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

/**
 * Pregunta al usuario con un modal bonito. Devuelve Promise<boolean>.
 *
 * @example
 *   if (await askConfirm('¿Eliminar este cliente?')) { ... }
 *   if (await askConfirm({ title: 'Borrar', message: '...', tone: 'danger', confirmText: 'Sí, borrar' })) { ... }
 */
export function askConfirm(opts: ConfirmOptions | string): Promise<boolean> {
  const normalized: ConfirmOptions =
    typeof opts === 'string' ? { message: opts } : opts;
  if (!dispatcher) {
    // Fallback si el provider aún no se montó (raro)
    return Promise.resolve(window.confirm(normalized.message));
  }
  return dispatcher(normalized);
}

const TONE_STYLES: Record<
  ConfirmTone,
  { iconBg: string; iconColor: string; confirmBtn: string; icon: JSX.Element }
> = {
  info: {
    iconBg: 'bg-sky-100',
    iconColor: 'text-sky-600',
    confirmBtn: 'bg-kubo-primary hover:bg-kubo-primary-dark text-white',
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </>
    ),
  },
  warning: {
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    confirmBtn: 'bg-amber-500 hover:bg-amber-600 text-white',
    icon: (
      <>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
  },
  danger: {
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    confirmBtn: 'bg-red-600 hover:bg-red-700 text-white',
    icon: (
      <>
        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M10 11v6M14 11v6" />
      </>
    ),
  },
};

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const ask = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setState({ ...opts, id, resolve });
    });
  }, []);

  useEffect(() => {
    dispatcher = ask;
    return () => {
      dispatcher = null;
    };
  }, [ask]);

  const close = useCallback(
    (value: boolean) => {
      if (!state) return;
      state.resolve(value);
      setState(null);
    },
    [state],
  );

  // Cerrar con ESC / confirmar con ENTER
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state, close]);

  return (
    <>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-[fadeIn_.15s_ease-out]"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => close(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-[scaleIn_.18s_ease-out]">
            <div className="flex items-start gap-4">
              <div
                className={`w-12 h-12 rounded-full ${TONE_STYLES[state.tone ?? 'info'].iconBg} flex items-center justify-center flex-shrink-0`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`w-6 h-6 ${TONE_STYLES[state.tone ?? 'info'].iconColor}`}
                >
                  {TONE_STYLES[state.tone ?? 'info'].icon}
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-slate-900 text-lg leading-tight">
                  {state.title ?? 'Confirmar'}
                </h3>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed whitespace-pre-wrap">
                  {state.message}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => close(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition"
                autoFocus
              >
                {state.cancelText ?? 'Cancelar'}
              </button>
              <button
                onClick={() => close(true)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${TONE_STYLES[state.tone ?? 'info'].confirmBtn}`}
              >
                {state.confirmText ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
