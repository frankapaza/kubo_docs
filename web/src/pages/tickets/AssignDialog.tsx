import { useEffect, useState } from 'react';

import { ticketsApi, supportAgentsApi } from '../../api/tickets.api';
import type { ServiceCategory, SupportAgent, SupportAgentView } from '../../api/types';
import { SERVICE_CATEGORY_LABELS } from '../../api/types';

interface Props {
  open: boolean;
  ticketId: number;
  serviceCategory: ServiceCategory | null;
  onCancel: () => void;
  onConfirm: (v: { assigneeUserId: number; reason?: string }) => void;
}

/**
 * Regla 01 del prototipo: el sistema propone, la persona confirma. Al abrir,
 * pide la sugerencia de GET /tickets/:id/suggest-assignee y la preselecciona
 * en el <select>, mostrando por qué (especialidad + carga) — pero el envío
 * siempre requiere que la persona confirme el clic; nada se auto-asigna.
 */
export default function AssignDialog({ open, ticketId, serviceCategory, onCancel, onConfirm }: Props) {
  const [agents, setAgents] = useState<SupportAgentView[]>([]);
  const [suggestion, setSuggestion] = useState<SupportAgent | null>(null);
  const [assigneeUserId, setAssigneeUserId] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // `cancelled` evita que una carga obsoleta (cerrar y reabrir rápido)
  // pise el estado del formulario — mismo idioma que TicketDetailPage.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSuggestion(null);
    setAssigneeUserId('');
    setReason('');
    Promise.all([supportAgentsApi.list(), ticketsApi.suggestAssignee(ticketId)])
      .then(([agentsData, suggested]) => {
        if (cancelled) return;
        setAgents(agentsData);
        setSuggestion(suggested);
        if (suggested) setAssigneeUserId(suggested.userId);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e?.response?.data?.message ?? 'No se pudo cargar la lista de técnicos');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ticketId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const suggestedAgent = suggestion ? agents.find((a) => a.userId === suggestion.userId) ?? null : null;
  const ready = assigneeUserId !== '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-dialog-title"
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, padding: 22, width: 480, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <h2 id="assign-dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Asignar técnico
        </h2>

        {loading && <span style={{ fontSize: 12, color: '#6d7577' }}>Buscando sugerencia…</span>}
        {loadError && (
          <span role="alert" style={{ fontSize: 12, color: 'oklch(0.5 0.16 25)' }}>
            {loadError}
          </span>
        )}

        {!loading && !loadError && (
          <>
            {suggestedAgent ? (
              <div style={{ fontSize: 12, color: '#4a5052', lineHeight: 1.5, background: '#fafbfb', border: '1px solid #eceeef', borderRadius: 6, padding: '8px 10px' }}>
                Sugerencia: <strong>{suggestedAgent.fullName}</strong> — especialista en{' '}
                {serviceCategory ? SERVICE_CATEGORY_LABELS[serviceCategory] : 'la categoría del ticket'}, con{' '}
                {suggestedAgent.openTickets} ticket{suggestedAgent.openTickets === 1 ? '' : 's'} abierto
                {suggestedAgent.openTickets === 1 ? '' : 's'} ahora mismo. Confirma o elige otro técnico.
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#6d7577', lineHeight: 1.5, background: '#fafbfb', border: '1px solid #eceeef', borderRadius: 6, padding: '8px 10px' }}>
                No hay una sugerencia automática {serviceCategory ? '' : '(el ticket no tiene categoría de servicio)'}
                . Elige el técnico manualmente.
              </div>
            )}

            <label htmlFor="assign-technician">
              <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Técnico</span>
              <select
                id="assign-technician"
                value={assigneeUserId}
                onChange={(e) => setAssigneeUserId(e.target.value ? Number(e.target.value) : '')}
                style={{ fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6, width: '100%', boxSizing: 'border-box' }}
              >
                <option value="">Selecciona un técnico…</option>
                {agents.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.fullName} · {a.level} · {a.openTickets} abierto{a.openTickets === 1 ? '' : 's'}
                    {suggestion?.userId === a.userId ? ' (sugerido)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="assign-reason">
              <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Motivo (opcional)</span>
              <input
                id="assign-reason"
                type="text"
                value={reason}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej: coincide con la especialidad y tiene menos carga"
                style={{ fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6, width: '100%', boxSizing: 'border-box' }}
              />
            </label>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ fontSize: 13, padding: '9px 14px', borderRadius: 7, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer' }}>
            Cancelar
          </button>
          <button
            disabled={!ready}
            onClick={() => onConfirm({ assigneeUserId: Number(assigneeUserId), reason: reason.trim() || undefined })}
            style={{ fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: ready ? '#15191a' : '#c9cdce', color: '#fff', border: 'none', cursor: ready ? 'pointer' : 'not-allowed' }}
          >
            Asignar
          </button>
        </div>
      </div>
    </div>
  );
}
