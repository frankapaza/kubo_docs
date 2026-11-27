import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { workItemsApi } from '../../api/work-items.api';
import type { WorkItem } from '../../api/types';
import { toast } from '../../ui/Toast';
import RequestDetailDialog from './RequestDetailDialog';

const button: React.CSSProperties = {
  fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--k-border)', background: '#fff', cursor: 'pointer',
};

/**
 * «Redactar especificación con IA»: deja la Especificación como borrador en
 * Documentos y muestra las preguntas abiertas (para mandarlas con «Pedir más
 * detalle») y, en proyectos nuevos, el brief de prototipo listo para copiar.
 */
export default function WorkItemSpecAssistant({ item, onChanged }: { item: WorkItem; onChanged?: () => void }) {
  const qc = useQueryClient();
  const [askOpen, setAskOpen] = useState(false);
  const draft = useMutation({
    mutationFn: () => workItemsApi.draftSpec(item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-item-docs', item.id] });
      toast.success('Especificación generada: quedó como borrador en Documentos para revisar y aprobar.');
      onChanged?.();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'No se pudo generar la especificación.'),
  });

  const out = draft.data;
  const puedePreguntar = item.status === 'SOLICITADO' || item.status === 'FALTA_INFO';
  const preguntas = out?.preguntas ?? [];

  const copyBrief = async () => {
    if (!out?.brief) return;
    try {
      await navigator.clipboard.writeText(out.brief);
      toast.success('Brief copiado: pégalo en Claude para armar el prototipo.');
    } catch {
      toast.error('No se pudo copiar; selecciona el texto y cópialo a mano.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
      <div style={{ color: 'var(--k-muted)', lineHeight: 1.5 }}>
        La IA ordena lo que pidió el cliente en una Especificación (objetivo, alcance, reglas, criterios) y lista las
        dudas como preguntas abiertas.
        {item.requestType === 'PROYECTO' && ' Como es un proyecto nuevo, también arma el brief para el prototipo.'}
      </div>
      <div>
        <button
          type="button"
          disabled={draft.isPending}
          onClick={() => draft.mutate()}
          style={{ ...button, background: 'var(--k-primary)', color: '#fff', border: 'none', fontWeight: 600, opacity: draft.isPending ? 0.6 : 1 }}
        >
          {draft.isPending ? 'Redactando… (puede tardar un minuto)' : out ? 'Volver a redactar' : 'Redactar especificación con IA'}
        </button>
      </div>

      {out && (
        <div style={{ padding: '10px 12px', border: '1px solid var(--k-border-soft)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong>Preguntas abiertas</strong>
          {preguntas.length === 0 ? (
            <span style={{ color: 'var(--k-muted)' }}>La IA no encontró dudas.</span>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              {preguntas.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}
          {preguntas.length > 0 && puedePreguntar && (
            <div>
              <button type="button" style={button} onClick={() => setAskOpen(true)}>
                Pedir más detalle al cliente con estas preguntas
              </button>
            </div>
          )}
        </div>
      )}

      {out?.brief && (
        <div style={{ padding: '10px 12px', border: '1px solid var(--k-border-soft)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <strong>Brief de prototipo</strong>
            <button type="button" style={button} onClick={copyBrief}>Copiar</button>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 260, overflowY: 'auto', color: 'var(--k-ink-2)' }}>
            {out.brief}
          </pre>
          <span style={{ color: 'var(--k-muted)' }}>También quedó como PDF en Documentos.</span>
        </div>
      )}

      <RequestDetailDialog
        item={askOpen ? item : null}
        initialMessage={preguntas.map((p) => `- ${p}`).join('\n')}
        onCancel={() => setAskOpen(false)}
        onDone={() => {
          setAskOpen(false);
          onChanged?.();
        }}
      />
    </div>
  );
}
