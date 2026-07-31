import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: (v: { resolutionMd: string; rootCause: string; correctiveAction: string }) => void;
}

export default function ResolveDialog({ open, onCancel, onConfirm }: Props) {
  const [resolutionMd, setResolutionMd] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');

  // Cerrar con ESC, mismo idioma que web/src/ui/ConfirmDialog.tsx: un
  // usuario de teclado espera el mismo comportamiento en todos los modales
  // de la app, no solo en el de confirmación genérico.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const ready = resolutionMd.trim() && rootCause.trim() && correctiveAction.trim();

  const field = (label: string, value: string, set: (v: string) => void, rows: number, id: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }} htmlFor={id}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <textarea
        id={id}
        value={value}
        rows={rows}
        onChange={(e) => set(e.target.value)}
        style={{ fontSize: 13, padding: 9, border: '1px solid #dfe3e4', borderRadius: 6, resize: 'vertical', fontFamily: 'inherit' }}
      />
    </label>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolve-dialog-title"
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, padding: 22, width: 560, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <h2 id="resolve-dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Marcar como resuelto</h2>
        <span style={{ fontSize: 12, color: '#6d7577', lineHeight: 1.5 }}>
          Los tres campos son obligatorios: sin ellos el ticket no se puede resolver.
        </span>
        {field('Solución aplicada', resolutionMd, setResolutionMd, 4, 'resolve-solution')}
        {field('Causa raíz', rootCause, setRootCause, 2, 'resolve-root-cause')}
        {field('Acción correctiva / preventiva', correctiveAction, setCorrectiveAction, 2, 'resolve-corrective-action')}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ fontSize: 13, padding: '9px 14px', borderRadius: 7, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer' }}>
            Cancelar
          </button>
          <button
            disabled={!ready}
            onClick={() => onConfirm({ resolutionMd, rootCause, correctiveAction })}
            style={{ fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: ready ? '#15191a' : '#c9cdce', color: '#fff', border: 'none', cursor: ready ? 'pointer' : 'not-allowed' }}
          >
            Resolver
          </button>
        </div>
      </div>
    </div>
  );
}
