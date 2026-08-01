import { useEffect, useState } from 'react';

import { workItemsApi } from '../../api/work-items.api';
import { clientsApi } from '../../api/clients.api';
import { projectsApi } from '../../api/projects.api';
import { supportAgentsApi } from '../../api/tickets.api';
import type { SupportAgentView, WorkItemDetail, WorkItemPriority } from '../../api/types';
import { PRIORITY_STYLES, STATUS_LABELS } from './workitem-ui';
import WorkItemTimeline from './WorkItemTimeline';

export interface WorkItemPanelProps {
  workItemId: number;
  onClose: () => void;
  /**
   * Avisa al tablero que algo cambió (prioridad o asignado), para que
   * refresque su propia lista — necesario porque el tablero puede estar
   * filtrado por asignado o prioridad, y el ítem podría dejar de calzar con
   * el filtro vigente.
   */
  onChanged?: () => void;
}

const PRIORITIES: WorkItemPriority[] = ['ALTA', 'MEDIA', 'BAJA'];

const DUE_DATE_FORMATTER = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return 'Sin fecha objetivo';
  return DUE_DATE_FORMATTER.format(new Date(`${dueDate}T00:00:00`));
}

const fieldRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8 };
const fieldLabel: React.CSSProperties = { color: '#6d7577' };
const fieldValue: React.CSSProperties = { color: '#3a4041', textAlign: 'right' };

/**
 * Panel lateral de detalle: se abre desde una tarjeta del tablero (Tarea
 * 10, `onOpen`). Trae su propio detalle con GET /work-items/:id (que
 * responde `{ workItem, timeline }`, no el ítem pelado) y resuelve cliente,
 * proyecto y nombres de asignado por separado.
 *
 * Cambiar prioridad o asignado usa sus propios endpoints
 * (POST .../priority, POST .../assign) — nunca PATCH /work-items/:id, que
 * deliberadamente no acepta esos dos campos (ver UpdateWorkItemDto) porque
 * cada uno escribe su propio evento de timeline. Tras cada cambio se
 * recarga el detalle para que el timeline mostrado sea siempre el real, no
 * uno optimista.
 */
export default function WorkItemPanel({ workItemId, onClose, onChanged }: WorkItemPanelProps) {
  const [detail, setDetail] = useState<WorkItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [agents, setAgents] = useState<SupportAgentView[]>([]);
  const [usersById, setUsersById] = useState<Map<number, string>>(new Map());
  const [clientName, setClientName] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  // Un fallo al escribir el cambio y un fallo al refrescar después de que el
  // cambio SÍ se guardó son hechos distintos — igual que en
  // WorkItemsBoardPage.performMove — así que viven en variables separadas.
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Carga el detalle. `cancelled` evita que una carga obsoleta (el usuario
  // cierra el panel, o abre otro ítem, antes de que responda el servidor)
  // pise el estado de un ítem distinto.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setDetail(null);
    workItemsApi
      .findOne(workItemId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e?.response?.data?.message ?? 'No se pudo cargar el requerimiento');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workItemId]);

  // Mismo patrón que WorkItemsBoardPage: los nombres de asignado se resuelven
  // con GET /support-agents, nunca con GET /users (restringido por rol).
  useEffect(() => {
    let cancelled = false;
    supportAgentsApi
      .list()
      .then((list) => {
        if (cancelled) return;
        setAgents(list);
        setUsersById(new Map(list.map((a) => [a.userId, a.fullName])));
      })
      .catch((e) => {
        console.warn('[WorkItemPanel] No se pudo cargar la lista de técnicos.', e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clientId = detail?.workItem.clientId ?? null;
  useEffect(() => {
    if (!clientId) {
      setClientName(null);
      return;
    }
    let cancelled = false;
    clientsApi
      .findOne(clientId)
      .then((c) => {
        if (!cancelled) setClientName(c.razonSocial);
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('[WorkItemPanel] No se pudo cargar el cliente del requerimiento.', e);
          setClientName(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const projectId = detail?.workItem.projectId ?? null;
  useEffect(() => {
    if (!projectId) {
      setProjectName(null);
      return;
    }
    let cancelled = false;
    projectsApi
      .findOne(projectId)
      .then((p) => {
        if (!cancelled) setProjectName(p.name);
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('[WorkItemPanel] No se pudo cargar el proyecto del requerimiento.', e);
          setProjectName(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Tras una escritura exitosa (assign/changePriority), se relee el detalle
  // completo: es la única forma de que el timeline mostrado refleje el
  // evento que el backend acaba de registrar, en vez de simularlo aquí.
  const reloadAfterChange = async () => {
    try {
      const data = await workItemsApi.findOne(workItemId);
      setDetail(data);
      setRefreshError(null);
    } catch (e) {
      setRefreshError(
        'El cambio se guardó, pero el panel no se pudo actualizar. Ciérralo y vuelve a abrirlo para ver el timeline al día.',
      );
      console.warn('[WorkItemPanel] Fallo al refrescar el detalle tras un cambio.', e);
    }
    onChanged?.();
  };

  const handlePriorityChange = async (value: WorkItemPriority) => {
    setBusy(true);
    setActionError(null);
    try {
      await workItemsApi.changePriority(workItemId, { priority: value });
    } catch (e: any) {
      setActionError(e?.response?.data?.message ?? 'No se pudo cambiar la prioridad.');
      setBusy(false);
      return;
    }
    await reloadAfterChange();
    setBusy(false);
  };

  const handleAssigneeChange = async (value: string) => {
    const assigneeUserId = value ? Number(value) : null;
    setBusy(true);
    setActionError(null);
    try {
      await workItemsApi.assign(workItemId, { assigneeUserId });
    } catch (e: any) {
      setActionError(e?.response?.data?.message ?? 'No se pudo cambiar el asignado.');
      setBusy(false);
      return;
    }
    await reloadAfterChange();
    setBusy(false);
  };

  const item = detail?.workItem ?? null;
  const label = item?.code ?? `#${workItemId}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="work-item-panel-title"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
        display: 'flex', justifyContent: 'flex-end', zIndex: 55,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', width: 440, maxWidth: '94vw', height: '100%', overflowY: 'auto',
          padding: 22, display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: '-8px 0 24px rgba(0,0,0,0.14)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#6d7577' }}>{label}</span>
            <h2 id="work-item-panel-title" style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 600 }}>
              {item?.title ?? 'Requerimiento'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel de detalle"
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </div>

        {loading && <span style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</span>}
        {loadError && (
          <span role="alert" style={{ fontSize: 13, color: 'oklch(0.5 0.16 25)' }}>{loadError}</span>
        )}

        {item && (
          <>
            {actionError && (
              <div
                role="alert"
                style={{
                  fontSize: 12, color: 'oklch(0.5 0.16 25)', background: 'oklch(0.96 0.02 25)',
                  border: '1px solid oklch(0.88 0.05 25)', borderRadius: 6, padding: '8px 10px',
                }}
              >
                {actionError}
              </div>
            )}
            {refreshError && (
              <div
                role="alert"
                style={{
                  fontSize: 12, color: 'oklch(0.5 0.11 70)', background: 'oklch(0.97 0.02 78)',
                  border: '1px solid oklch(0.9 0.05 78)', borderRadius: 6, padding: '8px 10px',
                }}
              >
                {refreshError}
              </div>
            )}

            <section>
              <h3 style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#6d7577' }}>Descripción</h3>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#3a4041', whiteSpace: 'pre-wrap' }}>
                {item.descriptionMd || 'Sin descripción.'}
              </p>
            </section>

            {item.acceptanceCriteria && item.acceptanceCriteria.length > 0 && (
              <section>
                <h3 style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#6d7577' }}>
                  Criterios de aceptación
                </h3>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: '#3a4041' }}>
                  {item.acceptanceCriteria.map((c, idx) => (
                    <li key={idx}>{c}</li>
                  ))}
                </ul>
              </section>
            )}

            <section style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <div style={fieldRow}>
                <span style={fieldLabel}>Estado</span>
                <span style={fieldValue}>{STATUS_LABELS[item.status]}</span>
              </div>
              <div style={fieldRow}>
                <span style={fieldLabel}>Cliente</span>
                <span style={fieldValue}>{clientName ?? String(item.clientId)}</span>
              </div>
              <div style={fieldRow}>
                <span style={fieldLabel}>Proyecto</span>
                <span style={fieldValue}>{item.projectId ? projectName ?? String(item.projectId) : 'Sin proyecto'}</span>
              </div>
              <div style={fieldRow}>
                <span style={fieldLabel}>Fecha objetivo</span>
                <span style={fieldValue}>{formatDueDate(item.dueDate)}</span>
              </div>
            </section>
            <span style={{ fontSize: 11, color: '#9aa1a2', lineHeight: 1.5, marginTop: -8 }}>
              La fecha objetivo es una meta que se propone el equipo, no un compromiso de SLA con el cliente.
            </span>

            <label htmlFor="work-item-panel-priority">
              <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Prioridad</span>
              <select
                id="work-item-panel-priority"
                value={item.priority}
                disabled={busy}
                aria-label={`Cambiar prioridad de ${label}`}
                onChange={(e) => handlePriorityChange(e.target.value as WorkItemPriority)}
                style={{
                  fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6,
                  width: '100%', boxSizing: 'border-box',
                  background: PRIORITY_STYLES[item.priority].bg, color: PRIORITY_STYLES[item.priority].fg,
                  fontWeight: 600,
                }}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>

            <label htmlFor="work-item-panel-assignee">
              <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Asignado</span>
              <select
                id="work-item-panel-assignee"
                value={item.assigneeUserId ?? ''}
                disabled={busy}
                aria-label={`Cambiar asignado de ${label}`}
                onChange={(e) => handleAssigneeChange(e.target.value)}
                style={{
                  fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6,
                  width: '100%', boxSizing: 'border-box',
                }}
              >
                <option value="">Sin asignar</option>
                {agents.map((a) => (
                  <option key={a.userId} value={a.userId}>{a.fullName}</option>
                ))}
              </select>
            </label>

            <section>
              <h3 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 600, color: '#6d7577' }}>Historial</h3>
              <WorkItemTimeline events={detail!.timeline} usersById={usersById} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
