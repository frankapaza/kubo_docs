import { useEffect, useState } from 'react';

import type { TicketImpact, TicketPriority, TicketUrgency } from '../../api/types';
import { TICKET_IMPACTS, TICKET_URGENCIES, previewPriority } from './ticket-ui';

const TICKET_PRIORITIES: TicketPriority[] = ['P1', 'P2', 'P3', 'P4'];

interface Props {
  open: boolean;
  currentImpact: TicketImpact | null;
  currentUrgency: TicketUrgency | null;
  currentPriority: TicketPriority;
  onCancel: () => void;
  onConfirm: (
    v:
      | { impact: TicketImpact; urgency: TicketUrgency; reason: string }
      | { priority: TicketPriority; reason: string },
  ) => void;
}

type Mode = 'matrix' | 'manual';

/**
 * POST /tickets/:id/priority acepta impact/urgency (recalcula por la
 * matriz) O priority (la fija a mano y marca priorityOverridden) — nunca
 * ambos a la vez, ver TicketAssignmentService.overridePriority. El motivo
 * es obligatorio en los dos modos.
 */
export default function OverridePriorityDialog({
  open,
  currentImpact,
  currentUrgency,
  currentPriority,
  onCancel,
  onConfirm,
}: Props) {
  const [mode, setMode] = useState<Mode>('matrix');
  const [impact, setImpact] = useState<TicketImpact>(currentImpact ?? 'MEDIO');
  const [urgency, setUrgency] = useState<TicketUrgency>(currentUrgency ?? 'MEDIA');
  const [priority, setPriority] = useState<TicketPriority>(currentPriority);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('matrix');
    setImpact(currentImpact ?? 'MEDIO');
    setUrgency(currentUrgency ?? 'MEDIA');
    setPriority(currentPriority);
    setReason('');
  }, [open, currentImpact, currentUrgency, currentPriority]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const resultingPriority = mode === 'matrix' ? previewPriority(impact, urgency) : priority;
  const ready = reason.trim().length >= 3;

  const submit = () => {
    if (!ready) return;
    if (mode === 'matrix') {
      onConfirm({ impact, urgency, reason: reason.trim() });
    } else {
      onConfirm({ priority, reason: reason.trim() });
    }
  };

  const selectStyle: React.CSSProperties = { fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6, width: '100%', boxSizing: 'border-box' };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="priority-dialog-title"
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, padding: 22, width: 480, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <h2 id="priority-dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Ajustar prioridad
        </h2>

        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #eceeef' }}>
          {(['matrix', 'manual'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: '8px 10px',
                border: 'none',
                borderBottom: mode === m ? '2px solid #15191a' : '2px solid transparent',
                background: 'transparent',
                color: mode === m ? '#15191a' : '#6d7577',
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {m === 'matrix' ? 'Impacto / urgencia' : 'Fijar a mano'}
            </button>
          ))}
        </div>

        {mode === 'matrix' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label htmlFor="priority-impact">
              <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Impacto</span>
              <select id="priority-impact" value={impact} onChange={(e) => setImpact(e.target.value as TicketImpact)} style={selectStyle}>
                {TICKET_IMPACTS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
            <label htmlFor="priority-urgency">
              <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Urgencia</span>
              <select id="priority-urgency" value={urgency} onChange={(e) => setUrgency(e.target.value as TicketUrgency)} style={selectStyle}>
                {TICKET_URGENCIES.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <label htmlFor="priority-manual">
            <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Prioridad</span>
            <select id="priority-manual" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} style={selectStyle}>
              {TICKET_PRIORITIES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
        )}

        <span style={{ fontSize: 12, color: '#4a5052' }}>
          Prioridad resultante: <strong>{resultingPriority}</strong>
        </span>

        <label htmlFor="priority-reason">
          <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Motivo (obligatorio)</span>
          <textarea
            id="priority-reason"
            value={reason}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            style={{ fontSize: 13, padding: 9, border: '1px solid #dfe3e4', borderRadius: 6, resize: 'vertical', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ fontSize: 13, padding: '9px 14px', borderRadius: 7, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer' }}>
            Cancelar
          </button>
          <button
            disabled={!ready}
            onClick={submit}
            style={{ fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: ready ? '#15191a' : '#c9cdce', color: '#fff', border: 'none', cursor: ready ? 'pointer' : 'not-allowed' }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
