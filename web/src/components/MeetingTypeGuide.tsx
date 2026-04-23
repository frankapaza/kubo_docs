import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MEETING_TYPE_GUIDES,
  MEETING_TYPE_LABELS,
  type MeetingType,
} from '../api/types';
import { CheckIcon, InfoIcon } from './ui/Icon';

export function MeetingTypeGuideContent({ type }: { type: MeetingType }) {
  const guide = MEETING_TYPE_GUIDES[type];
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 mb-1">
          Ejemplo
        </p>
        <p className="text-xs text-slate-600 leading-relaxed">{guide.example}</p>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 mb-1">
          Puntos que debe cubrir el acta
        </p>
        <ul className="text-xs text-slate-700 space-y-1 list-disc pl-4">
          {guide.sections.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function checklistStorageKey(meetingId: number) {
  return `kubo:meeting-checklist:${meetingId}`;
}

export function MeetingTypeChecklist({
  type,
  meetingId,
}: {
  type: MeetingType;
  meetingId: number;
}) {
  const sections = MEETING_TYPE_GUIDES[type].sections;
  const storageKey = checklistStorageKey(meetingId);

  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(checked));
    } catch {
      /* cuota llena u otro error: ignorar */
    }
  }, [checked, storageKey]);

  const { done, total, pct } = useMemo(() => {
    const t = sections.length;
    const d = sections.filter((s) => checked[s]).length;
    return { done: d, total: t, pct: t === 0 ? 0 : Math.round((d / t) * 100) };
  }, [checked, sections]);

  const toggle = (s: string) => setChecked((prev) => ({ ...prev, [s]: !prev[s] }));
  const reset = () => setChecked({});

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-700">
            {done} de {total} puntos cubiertos
          </p>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1.5">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        {done > 0 && (
          <button
            type="button"
            onClick={reset}
            className="text-[11px] text-slate-400 hover:text-slate-600 transition shrink-0"
          >
            Reiniciar
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {sections.map((s) => {
          const isOn = !!checked[s];
          return (
            <li key={s}>
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <span
                  className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition ${
                    isOn
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'bg-white border-slate-300 group-hover:border-slate-400'
                  }`}
                >
                  {isOn && <CheckIcon size={12} />}
                </span>
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggle(s)}
                  className="sr-only"
                />
                <span
                  className={`text-sm leading-snug transition ${
                    isOn ? 'text-slate-400 line-through' : 'text-slate-700'
                  }`}
                >
                  {s}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MeetingTypeGuidePopover({ type }: { type: MeetingType }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="w-5 h-5 rounded-full text-slate-400 hover:text-kubo-primary hover:bg-slate-100 inline-flex items-center justify-center transition"
        aria-label={`Ver ejemplo y puntos del acta — ${MEETING_TYPE_LABELS[type]}`}
      >
        <InfoIcon size={14} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-20 top-6 right-0 w-72 bg-white border border-slate-200 rounded-lg shadow-pop p-3"
        >
          <p className="text-sm font-semibold text-slate-900 mb-2">
            {MEETING_TYPE_LABELS[type]}
          </p>
          <MeetingTypeGuideContent type={type} />
        </div>
      )}
    </div>
  );
}
