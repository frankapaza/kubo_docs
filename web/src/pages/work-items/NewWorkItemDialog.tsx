import { useEffect, useState } from 'react';

import { workItemsApi } from '../../api/work-items.api';
import { clientsApi } from '../../api/clients.api';
import { projectsApi } from '../../api/projects.api';
import { supportAgentsApi } from '../../api/tickets.api';
import type { Client, Project, SupportAgentView, WorkItem, WorkItemPriority } from '../../api/types';

export interface NewWorkItemDialogProps {
  open: boolean;
  onCancel: () => void;
  onCreated: (item: WorkItem) => void;
}

const PRIORITIES: WorkItemPriority[] = ['ALTA', 'MEDIA', 'BAJA'];

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: '8px 10px',
  border: '1px solid #dfe3e4',
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
 * No incluye criterios de aceptación: por diseño de esta tarea, ese campo
 * solo se muestra en WorkItemPanel una vez creado el ítem (POST
 * /work-items acepta acceptanceCriteria, pero el formulario de alta no lo
 * pide todavía).
 *
 * La prioridad elegida aquí decide dónde cae el ítem dentro de PENDIENTE:
 * WorkItemsService.create calcula la posición por banda de prioridad
 * (insertionIndex), no simplemente al final de la columna.
 */
export default function NewWorkItemDialog({ open, onCancel, onCreated }: NewWorkItemDialogProps) {
  const [clientId, setClientId] = useState<number | ''>('');
  const [projectId, setProjectId] = useState<number | ''>('');
  const [title, setTitle] = useState('');
  const [descriptionMd, setDescriptionMd] = useState('');
  const [priority, setPriority] = useState<WorkItemPriority>('MEDIA');
  const [assigneeUserId, setAssigneeUserId] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');

  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<SupportAgentView[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resetea el formulario cada vez que se abre — mismo idioma que
  // NewTicketDialog: el diálogo se queda montado para no perder el efecto
  // de Escape entre aperturas.
  useEffect(() => {
    if (!open) return;
    setClientId('');
    setProjectId('');
    setTitle('');
    setDescriptionMd('');
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

  // Proyectos activos del cliente elegido; sin cliente, el select queda
  // vacío y deshabilitado.
  useEffect(() => {
    if (!open || !clientId) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    projectsApi
      .list({ status: 'ACTIVE', clientId })
      .then((p) => {
        if (!cancelled) setProjects(p.data);
      })
      .catch((e) => {
        if (!cancelled) console.warn('[NewWorkItemDialog] No se pudo cargar los proyectos del cliente.', e);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

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
      const created = await workItemsApi.create({
        clientId: Number(clientId),
        projectId: projectId || undefined,
        title: title.trim(),
        descriptionMd: descriptionMd.trim() || undefined,
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
          background: '#fff', borderRadius: 10, padding: 22, width: 560, maxWidth: '96vw',
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label htmlFor="new-wi-client">
            <span style={labelStyle}>Cliente *</span>
            <select
              id="new-wi-client"
              value={clientId}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : '';
                setClientId(v);
                setProjectId('');
              }}
              style={inputStyle}
            >
              <option value="">Selecciona un cliente…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.razonSocial}</option>
              ))}
            </select>
          </label>

          <label htmlFor="new-wi-project">
            <span style={labelStyle}>Proyecto</span>
            <select
              id="new-wi-project"
              value={projectId}
              disabled={!clientId}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')}
              style={{ ...inputStyle, cursor: clientId ? 'pointer' : 'not-allowed', background: clientId ? '#fff' : '#f5f6f6' }}
            >
              <option value="">{clientId ? '(sin proyecto)' : 'Elige un cliente primero'}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
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

        <label htmlFor="new-wi-description">
          <span style={labelStyle}>Descripción</span>
          <textarea
            id="new-wi-description"
            value={descriptionMd}
            rows={4}
            onChange={(e) => setDescriptionMd(e.target.value)}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </label>

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
        <span style={{ fontSize: 11, color: '#6d7577', marginTop: -10, lineHeight: 1.5 }}>
          Es un objetivo que se propone el equipo, no un compromiso de SLA con el cliente: a diferencia de
          un ticket, este requerimiento no trae un reloj contractual corriendo.
        </span>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #eceeef', paddingTop: 14 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{ fontSize: 13, padding: '9px 14px', borderRadius: 7, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={submit}
            style={{
              fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7,
              background: busy || !ready ? '#c9cdce' : '#15191a', color: '#fff', border: 'none',
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
