import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { MeetingNote, meetingNotesApi } from '../../api/acta-annexes.api';
import { toast } from '../../ui/Toast';

const KINDS: Array<{ id: MeetingNote['kind']; label: string; color: string }> = [
  { id: 'NOTA', label: 'Nota', color: '#4b5563' },
  { id: 'ACUERDO', label: 'Acuerdo', color: '#1e7a3c' },
  { id: 'TAREA', label: 'Tarea', color: '#053777' },
];

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/**
 * Notas mientras se graba (spec 2026-11-28, entrega 2): quedan marcadas en el minuto de
 * la grabación y la IA las usa al armar el acta (acuerdos y tareas entran tal cual).
 */
export default function MeetingNotesPanel({ meetingId, elapsed, canAdd }: { meetingId: number; elapsed: number; canAdd: boolean }) {
  const qc = useQueryClient();
  const key = ['meeting-notes', meetingId];
  const { data: notes = [] } = useQuery({ queryKey: key, queryFn: () => meetingNotesApi.list(meetingId) });
  const [kind, setKind] = useState<MeetingNote['kind']>('NOTA');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      await meetingNotesApi.create(meetingId, { offsetSec: Math.floor(elapsed), kind, text: t });
      setText('');
      await qc.invalidateQueries({ queryKey: key });
    } catch {
      toast.error('No se pudo guardar la nota.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Notas de la reunión" className="rounded-xl border border-amber-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Tus notas</h2>
        <span className="text-xs text-slate-500">{notes.length} nota(s) · la IA las usa al armar el acta</span>
      </div>

      {notes.length > 0 && (
        <ol className="flex flex-col gap-2 max-h-64 overflow-y-auto">
          {notes.map((n) => {
            const k = KINDS.find((x) => x.id === n.kind)!;
            return (
              <li key={n.id} className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
                <span className="text-slate-500 tabular-nums">{mmss(n.offsetSec)}</span>
                <span className="font-semibold" style={{ color: k.color }}>{k.label}:</span>
                <span className="flex-1 min-w-0">{n.text}</span>
                <button
                  type="button"
                  aria-label="Quitar nota"
                  onClick={async () => { await meetingNotesApi.remove(n.id); await qc.invalidateQueries({ queryKey: key }); }}
                  className="text-slate-400 hover:text-red-700 px-1"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {canAdd && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2" role="radiogroup" aria-label="Tipo de nota">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={kind === k.id}
                onClick={() => setKind(k.id)}
                className={`h-10 px-4 rounded-full border text-sm font-semibold ${kind === k.id ? 'bg-[#0F2A3D] text-white border-[#0F2A3D]' : 'bg-white text-slate-800 border-slate-300'}`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              aria-label="Tu nota"
              className="input flex-1 h-12"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
              placeholder={`Escribe y queda marcada en el minuto ${mmss(elapsed)}`}
              maxLength={2000}
            />
            <button type="button" onClick={add} disabled={busy || !text.trim()} className="h-12 px-5 rounded-lg bg-[#053777] text-white font-semibold disabled:opacity-50">
              Anotar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
