import { useEffect, useState } from 'react';

export interface ConcludeValues {
  solucion: string;
  rootCause?: string;
  correctiveAction?: string;
}

interface Props {
  open: boolean;
  count: number;
  onCancel: () => void;
  onConfirm: (v: ConcludeValues) => void;
}

const fieldStyle: React.CSSProperties = {
  fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6, width: '100%',
  boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical',
};
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 };

/**
 * POST /tickets/:id/conclude (solo ADMIN) para cada ticket seleccionado:
 * quedan Resueltos y Cerrados con la observación como solución, no como
 * cancelados.
 */
export default function ConcludeTicketsDialog({ open, count, onCancel, onConfirm }: Props) {
  const [solucion, setSolucion] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');

  useEffect(() => {
    if (!open) return;
    setSolucion('');
    setRootCause('');
    setCorrectiveAction('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const ready = solucion.trim().length >= 3;
  const plural = count === 1 ? 'ticket' : `${count} tickets`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conclude-dialog-title"
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, padding: 22, width: 520, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <h2 id="conclude-dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Concluir {plural}
        </h2>

        <label htmlFor="conclude-solucion">
          <span style={labelStyle}>Observación general (queda como solución aplicada)</span>
          <textarea
            id="conclude-solucion"
            autoFocus
            rows={4}
            value={solucion}
            onChange={(e) => setSolucion(e.target.value)}
            placeholder="Ej.: Atendidos y desplegados en la versión 2.3 del 25/11. Validado con el cliente."
            style={fieldStyle}
          />
        </label>

        <label htmlFor="conclude-causa">
          <span style={labelStyle}>Causa raíz (opcional)</span>
          <textarea id="conclude-causa" rows={2} value={rootCause} onChange={(e) => setRootCause(e.target.value)} style={fieldStyle} />
        </label>

        <label htmlFor="conclude-accion">
          <span style={labelStyle}>Acción correctiva (opcional)</span>
          <textarea id="conclude-accion" rows={2} value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} style={fieldStyle} />
        </label>

        <p style={{ margin: 0, fontSize: 12, color: '#6d7577', lineHeight: 1.5 }}>
          Cada ticket pasa por Asignado (a ti, si no tenía responsable), En atención, Resuelto y Cerrado, y todo queda en su
          historial. Si un ticket lo abrió un usuario del cliente, a ese usuario le llegan por correo los avisos de
          Resuelto y Cerrado, igual que al hacerlo a mano. Cerrado es definitivo.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onCancel}
            style={{ fontSize: 13, padding: '8px 14px', borderRadius: 6, border: '1px solid #d8dcdd', background: '#fff', cursor: 'pointer' }}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() =>
              ready &&
              onConfirm({
                solucion: solucion.trim(),
                rootCause: rootCause.trim() || undefined,
                correctiveAction: correctiveAction.trim() || undefined,
              })
            }
            style={{
              fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 6, border: 'none',
              background: ready ? '#15191a' : '#c9cdce', color: '#fff', cursor: ready ? 'pointer' : 'not-allowed',
            }}
          >
            Concluir {plural}
          </button>
        </div>
      </div>
    </div>
  );
}
