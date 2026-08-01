import { useEffect, useState } from 'react';

import type { WorkItemStatus } from '../../api/types';
import { STATUS_LABELS } from './workitem-ui';

export interface MoveReasonDialogProps {
  open: boolean;
  toStatus: WorkItemStatus | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * Pide el motivo cuando el destino de un movimiento es BLOQUEADO o
 * CANCELADO. Mismo patrón que web/src/ui/ConfirmDialog.tsx y
 * web/src/pages/tickets/ResolveDialog.tsx: role="dialog", cierre con Escape
 * y con clic en el backdrop, stopPropagation en el panel interno, y
 * confirmar deshabilitado mientras el motivo esté vacío.
 *
 * El backend (assertReason) rechaza un motivo vacío o de solo espacios con
 * 400 BAD_INPUT; este diálogo evita ese viaje redondo — nunca se llama a
 * onConfirm con una cadena vacía.
 */
export default function MoveReasonDialog({ open, toStatus, onCancel, onConfirm }: MoveReasonDialogProps) {
  const [reason, setReason] = useState('');

  // Cada vez que se abre para un movimiento nuevo, el motivo del anterior no
  // debe sobrevivir.
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open || !toStatus) return null;

  const ready = reason.trim().length > 0;
  const statusLabel = STATUS_LABELS[toStatus];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-reason-dialog-title"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, padding: 22, width: 440, maxWidth: '92vw',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <h2 id="move-reason-dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Mover a {statusLabel}
        </h2>
        <span style={{ fontSize: 12, color: '#6d7577', lineHeight: 1.5 }}>
          Este destino exige un motivo: sin él, el movimiento no se puede registrar.
        </span>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }} htmlFor="move-reason-textarea">
          <span style={{ fontSize: 12, fontWeight: 600 }}>Motivo</span>
          <textarea
            id="move-reason-textarea"
            value={reason}
            rows={3}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            style={{
              fontSize: 13, padding: 9, border: '1px solid #dfe3e4', borderRadius: 6,
              resize: 'vertical', fontFamily: 'inherit',
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontSize: 13, padding: '9px 14px', borderRadius: 7, background: '#fff',
              border: '1px solid #d8dcdd', cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => onConfirm(reason.trim())}
            style={{
              fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7,
              background: ready ? '#15191a' : '#c9cdce', color: '#fff', border: 'none',
              cursor: ready ? 'pointer' : 'not-allowed',
            }}
          >
            Mover
          </button>
        </div>
      </div>
    </div>
  );
}
