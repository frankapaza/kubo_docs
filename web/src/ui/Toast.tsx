import { ReactNode, useCallback, useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItemData {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration: number;
}

// Singleton: expuesto para llamar desde cualquier módulo (incluso fuera de React)
let dispatcher: ((t: Omit<ToastItemData, 'id'>) => void) | null = null;

export const toast = {
  success: (message: string, title?: string) =>
    dispatcher?.({ type: 'success', message, title, duration: 3500 }),
  error: (message: string, title?: string) =>
    dispatcher?.({ type: 'error', message, title, duration: 5000 }),
  warning: (message: string, title?: string) =>
    dispatcher?.({ type: 'warning', message, title, duration: 4500 }),
  info: (message: string, title?: string) =>
    dispatcher?.({ type: 'info', message, title, duration: 3500 }),
};

const STYLES: Record<
  ToastType,
  { bar: string; icon: string; iconPath: JSX.Element; label: string }
> = {
  success: {
    bar: 'border-l-emerald-500 bg-emerald-50/90',
    icon: 'text-emerald-600',
    iconPath: <path d="M20 6 9 17l-5-5" />,
    label: 'Listo',
  },
  error: {
    bar: 'border-l-red-500 bg-red-50/90',
    icon: 'text-red-600',
    iconPath: <path d="M18 6 6 18M6 6l12 12" />,
    label: 'Error',
  },
  warning: {
    bar: 'border-l-amber-500 bg-amber-50/90',
    icon: 'text-amber-600',
    iconPath: (
      <>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    label: 'Atención',
  },
  info: {
    bar: 'border-l-sky-500 bg-sky-50/90',
    icon: 'text-sky-600',
    iconPath: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </>
    ),
    label: 'Info',
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItemData[]>([]);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (t: Omit<ToastItemData, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const item: ToastItemData = { ...t, id };
      setItems((prev) => [...prev, item]);
      if (item.duration > 0) {
        setTimeout(() => remove(id), item.duration);
      }
    },
    [remove],
  );

  useEffect(() => {
    dispatcher = show;
    return () => {
      dispatcher = null;
    };
  }, [show]);

  return (
    <>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[380px] max-w-[calc(100vw-2rem)] pointer-events-none">
        {items.map((t) => (
          <ToastCard key={t.id} data={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </>
  );
}

function ToastCard({
  data,
  onClose,
}: {
  data: ToastItemData;
  onClose: () => void;
}) {
  const style = STYLES[data.type];
  return (
    <div
      className={`pointer-events-auto flex gap-3 items-start border-l-4 ${style.bar} backdrop-blur-sm shadow-lg rounded-lg px-4 py-3 animate-[toastIn_.18s_ease-out] relative overflow-hidden`}
      role="alert"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`w-5 h-5 flex-shrink-0 mt-0.5 ${style.icon}`}
      >
        {style.iconPath}
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 leading-tight">
          {data.title ?? style.label}
        </p>
        <p className="text-sm text-slate-700 mt-0.5 leading-snug break-words">
          {data.message}
        </p>
      </div>
      <button
        onClick={onClose}
        className="p-1 -m-1 rounded hover:bg-slate-200/50 text-slate-400 hover:text-slate-700 transition"
        aria-label="Cerrar"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
