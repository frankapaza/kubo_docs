import { useEffect, useRef, useState } from 'react';

import { workItemsApi } from '../../api/work-items.api';
import type { WorkItem } from '../../api/types';
import { toast } from '../../ui/Toast';

interface Props {
  /** El requerimiento a devolver; `null` cierra el diálogo. */
  item: Pick<WorkItem, 'id' | 'code' | 'title' | 'createdByClientUserId'> | null;
  /** Texto inicial (p. ej. las preguntas abiertas de la Especificación generada con IA). */
  initialMessage?: string;
  onCancel: () => void;
  onDone: (updated: WorkItem) => void;
}

const fieldStyle: React.CSSProperties = {
  fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6,
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', resize: 'vertical',
};

/**
 * «Pedir más detalle»: el requerimiento pasa a «Falta información», el
 * cliente ve la pregunta en el portal (y le llega por correo) y, cuando
 * completa, vuelve a Solicitados.
 */
export default function RequestDetailDialog({ item, initialMessage, onCancel, onDone }: Props) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!item) return;
    setMessage(initialMessage ?? '');
    setError(null);
    setBusy(false);
  }, [item, initialMessage]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [item, busy, onCancel]);

  if (!item) return null;

  const canSubmit = message.trim().length >= 3;
  const sinAutor = item.createdByClientUserId == null;

  const submit = async () => {
    if (inFlight.current || !canSubmit) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const out = await workItemsApi.requestDetail(item.id, message.trim());
      if (out.emailError) toast.error(out.emailError);
      else if (out.notified) toast.success('Pregunta enviada: el cliente la recibió por correo y la ve en el portal.');
      else toast.success('Pregunta registrada: el cliente la verá en el portal.');
      onDone(out.item);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo enviar la pregunta.');
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-detail-title"
      onClick={() => !busy && onCancel()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, padding: 22, width: 520, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <h2 id="request-detail-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Pedir más detalle · {item.code ?? `#${item.id}`}
        </h2>
        <span style={{ fontSize: 12, color: '#6d7577' }}>{item.title}</span>

        {error && (
          <div role="alert" style={{ fontSize: 12, color: 'oklch(0.5 0.16 25)', background: 'oklch(0.97 0.02 25)', padding: '8px 10px', borderRadius: 6 }}>
            {error}
          </div>
        )}

        <label htmlFor="request-detail-message">
          <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>¿Qué falta? *</span>
          <textarea
            id="request-detail-message"
            autoFocus
            rows={6}
            value={message}
            disabled={busy}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={'Ej.:\n- ¿En qué reporte exactamente (ruta del menú)?\n- ¿Qué perfiles deben verlo?\n- ¿Pueden enviar una captura de cómo lo esperan?'}
            style={fieldStyle}
          />
        </label>
        <span style={{ fontSize: 11, color: '#6d7577', lineHeight: 1.5 }}>
          El cliente verá este texto en su portal{sinAutor ? '' : ' y le llegará por correo'}. El requerimiento queda en
          «Falta información» hasta que responda; igual puedes aceptarlo o rechazarlo antes.
        </span>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{ fontSize: 13, padding: '8px 14px', borderRadius: 6, border: '1px solid #d8dcdd', background: '#fff', cursor: 'pointer' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !canSubmit}
            style={{
              fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 6, border: 'none', color: '#fff',
              background: busy || !canSubmit ? '#c9cdce' : '#15191a', cursor: busy || !canSubmit ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Enviando…' : 'Enviar al cliente'}
          </button>
        </div>
      </div>
    </div>
  );
}
