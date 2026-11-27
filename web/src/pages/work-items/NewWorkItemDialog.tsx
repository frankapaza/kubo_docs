import { useEffect, useState } from 'react';

import { workItemsApi } from '../../api/work-items.api';
import { clientsApi } from '../../api/clients.api';
import { supportAgentsApi } from '../../api/tickets.api';
import type { Client, SupportAgentView, WorkItem, WorkItemPriority, WorkItemRequestType } from '../../api/types';
import ClientSystemSelect from '../dev-connector/ClientSystemSelect';
import RequirementTemplateFields from '../requirements/RequirementTemplateFields';
import { composeDescription, parseCriteria, TemplateAnswers } from '../requirements/requirement-template';

export interface NewWorkItemDialogProps {
  open: boolean;
  onCancel: () => void;
  onCreated: (item: WorkItem) => void;
}

const PRIORITIES: WorkItemPriority[] = ['ALTA', 'MEDIA', 'BAJA'];

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: '8px 10px',
  border: '1px solid var(--k-border)',
  borderRadius: 6,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 5, display: 'block' };

/**
 * Alta de un requerimiento. Mismo patrón de diálogo que NewTicketDialog
 * (role="dialog", Escape, backdrop, stopPropagation en el panel interno).
 *
 * Usa el mismo formulario guiado que el portal (tipo de pedido, secciones y
 * criterios de aceptación), sin secciones obligatorias.
 *
 * La prioridad elegida aquí decide dónde cae el ítem dentro de PENDIENTE:
 * WorkItemsService.create calcula la posición por banda de prioridad
 * (insertionIndex), no simplemente al final de la columna.
 */
export default function NewWorkItemDialog({ open, onCancel, onCreated }: NewWorkItemDialogProps) {
  const [clientId, setClientId] = useState<number | ''>('');
  const [clientSystemId, setClientSystemId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [requestType, setRequestType] = useState<WorkItemRequestType>('CAMBIO');
  const [answers, setAnswers] = useState<TemplateAnswers>({});
  const [criteria, setCriteria] = useState('');
  const [priority, setPriority] = useState<WorkItemPriority>('MEDIA');
  const [assigneeUserId, setAssigneeUserId] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');

  const [clients, setClients] = useState<Client[]>([]);
  const [agents, setAgents] = useState<SupportAgentView[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resetea el formulario cada vez que se abre — mismo idioma que
  // NewTicketDialog: el diálogo se queda montado para no perder el efecto
  // de Escape entre aperturas.
  useEffect(() => {
    if (!open) return;
    setClientId('');
    setClientSystemId(null);
    setTitle('');
    setRequestType('CAMBIO');
    setAnswers({});
    setCriteria('');
    setPriority('MEDIA');
    setAssigneeUserId('');
    setDueDate('');
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    clientsApi
      .list({ status: 'CLIENT' })
      .then((list) => {
        if (!cancelled) setClients(list);
      })
      .catch((e) => {
        if (!cancelled) console.warn('[NewWorkItemDialog] No se pudo cargar la lista de clientes.', e);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    supportAgentsApi
      .list()
      .then((list) => {
        if (!cancelled) setAgents(list);
      })
      .catch((e) => {
        if (!cancelled) console.warn('[NewWorkItemDialog] No se pudo cargar la lista de técnicos.', e);
      });
    return () => {
      cancelled = true;
    };
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

  const ready = clientId !== '' && title.trim().length > 0;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const descriptionMd = composeDescription(requestType, answers);
      const acceptanceCriteria = parseCriteria(criteria);
      const created = await workItemsApi.create({
        clientId: Number(clientId),
        clientSystemId: clientSystemId ?? undefined,
        title: title.trim(),
        descriptionMd: descriptionMd || undefined,
        acceptanceCriteria: acceptanceCriteria.length ? acceptanceCriteria : undefined,
        requestType,
        priority,
        assigneeUserId: assigneeUserId || undefined,
        dueDate: dueDate || undefined,
      });
      onCreated(created);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo crear el requerimiento.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-work-item-dialog-title"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 16px', zIndex: 50, overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, padding: 22, width: 640, maxWidth: '96vw',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <h2 id="new-work-item-dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Nuevo requerimiento
        </h2>

        {error && (
          <div
            role="alert"
            style={{
              fontSize: 12, color: 'oklch(0.5 0.16 25)', background: 'oklch(0.96 0.02 25)',
              border: '1px solid oklch(0.88 0.05 25)', borderRadius: 6, padding: '8px 10px',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          <label htmlFor="new-wi-client">
            <span style={labelStyle}>Cliente *</span>
            <select
              id="new-wi-client"
              value={clientId}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : '';
                setClientId(v);
                // El sistema es de un cliente: al cambiar de cliente deja de valer.
                setClientSystemId(null);
              }}
              style={inputStyle}
            >
              <option value="">Selecciona un cliente…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.razonSocial}</option>
              ))}
            </select>
          </label>
          <ClientSystemSelect
            id="new-wi-system"
            clientId={clientId === '' ? null : clientId}
            value={clientSystemId}
            onChange={setClientSystemId}
          />
        </div>

        <label htmlFor="new-wi-title">
          <span style={labelStyle}>Título *</span>
          <input
            id="new-wi-title"
            type="text"
            value={title}
            maxLength={240}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />
        </label>

        <RequirementTemplateFields
          type={requestType}
          onTypeChange={setRequestType}
          answers={answers}
          onAnswersChange={setAnswers}
          criteria={criteria}
          onCriteriaChange={setCriteria}
          disabled={busy}
        />
        <span style={{ fontSize: 11, color: 'var(--k-muted)', marginTop: -8 }}>
          Aquí ninguna sección es obligatoria; en el portal el cliente sí debe completar las marcadas con *.
        </span>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label htmlFor="new-wi-priority">
            <span style={labelStyle}>Prioridad</span>
            <select
              id="new-wi-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as WorkItemPriority)}
              style={inputStyle}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>

          <label htmlFor="new-wi-assignee">
            <span style={labelStyle}>Asignado</span>
            <select
              id="new-wi-assignee"
              value={assigneeUserId}
              onChange={(e) => setAssigneeUserId(e.target.value ? Number(e.target.value) : '')}
              style={inputStyle}
            >
              <option value="">Sin asignar</option>
              {agents.map((a) => (
                <option key={a.userId} value={a.userId}>{a.fullName}</option>
              ))}
            </select>
          </label>
        </div>

        <label htmlFor="new-wi-due-date">
          <span style={labelStyle}>Fecha objetivo</span>
          <input
            id="new-wi-due-date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={inputStyle}
          />
        </label>
        <span style={{ fontSize: 11, color: 'var(--k-muted)', marginTop: -10, lineHeight: 1.5 }}>
          Es un objetivo que se propone el equipo, no un compromiso de SLA con el cliente: a diferencia de
          un ticket, este requerimiento no trae un reloj contractual corriendo.
        </span>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--k-border-soft)', paddingTop: 14 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{ fontSize: 13, padding: '9px 14px', borderRadius: 7, background: '#fff', border: '1px solid var(--k-border-strong)', cursor: 'pointer' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={submit}
            style={{
              fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7,
              background: busy || !ready ? 'var(--k-disabled)' : 'var(--k-primary)', color: '#fff', border: 'none',
              cursor: busy || !ready ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Creando…' : 'Crear requerimiento'}
          </button>
        </div>
      </div>
    </div>
  );
}
