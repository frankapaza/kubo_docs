import type { WorkItemEvent, WorkItemEventType } from '../../api/types';
import { STATUS_LABELS, WORK_ITEM_EVENT_DOTS } from './workitem-ui';

/**
 * Mismas etiquetas en español que TicketTimeline.tsx (EVENT_LABELS), pero
 * para WorkItemEventType — ver backend/src/modules/work-items/entities/
 * work-item-event.entity.ts y work-item-events.service.ts#typeForMove para
 * el catálogo de tipos.
 */
const EVENT_LABELS: Record<WorkItemEventType, string> = {
  CREATED: 'Creado',
  MOVED: 'Movido de columna',
  ASSIGNED: 'Asignado',
  COMMENT: 'Comentario',
  BLOCKED: 'Bloqueado',
  UNBLOCKED: 'Desbloqueado',
  CLOSED: 'Cerrado',
  REOPENED: 'Reabierto',
  CANCELLED: 'Cancelado',
  PRIORITY_CHANGED: 'Prioridad cambiada',
};

export interface WorkItemTimelineProps {
  events: WorkItemEvent[];
  /**
   * assigneeUserId -> nombre, para resolver el payload del evento ASSIGNED.
   * Se resuelve con GET /support-agents en el llamador (WorkItemPanel), no
   * aquí: este componente solo pinta lo que recibe.
   */
  usersById: Map<number, string>;
}

export default function WorkItemTimeline({ events, usersById }: WorkItemTimelineProps) {
  if (events.length === 0) {
    return <span style={{ fontSize: 12, color: '#6d7577' }}>Sin eventos todavía.</span>;
  }

  return (
    <>
      {events.map((e) => {
        // MOVED/BLOCKED/UNBLOCKED/CLOSED/REOPENED llevan fromStatus/toStatus;
        // ASSIGNED/PRIORITY_CHANGED/CREATED llevan su dato propio en payload
        // (ver work-item-board.service.ts y work-items.service.ts#create).
        const statusPair =
          e.fromStatus && e.toStatus ? `${STATUS_LABELS[e.fromStatus]} → ${STATUS_LABELS[e.toStatus]}` : null;
        const assigneeId =
          e.type === 'ASSIGNED' ? (e.payload?.assigneeUserId as number | null | undefined) : undefined;

        return (
          <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span
                style={{
                  width: 9, height: 9, borderRadius: '50%',
                  background: WORK_ITEM_EVENT_DOTS[e.type] ?? 'oklch(0.6 0.13 78)', marginTop: 5,
                }}
              />
              <span style={{ flex: 1, width: 1, background: '#e6e9e9' }} />
            </div>
            <div style={{ paddingBottom: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{EVENT_LABELS[e.type]}</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6d7577' }}>
                  {new Date(e.createdAt).toLocaleString('es-PE')}
                </span>
              </div>

              {statusPair && <span style={{ fontSize: 12, color: '#4a5052' }}>{statusPair}</span>}

              {e.type === 'PRIORITY_CHANGED' && e.payload && (
                <span style={{ fontSize: 12, color: '#4a5052' }}>
                  {String(e.payload.from)} → {String(e.payload.to)}
                </span>
              )}

              {e.type === 'CREATED' && e.payload?.priority != null && (
                <span style={{ fontSize: 12, color: '#4a5052' }}>
                  Prioridad inicial: {String(e.payload.priority)}
                </span>
              )}

              {assigneeId !== undefined && (
                <span style={{ fontSize: 12, color: '#4a5052' }}>
                  {assigneeId === null ? 'Sin asignar' : usersById.get(assigneeId) ?? `Usuario #${assigneeId}`}
                </span>
              )}

              {e.reason && <span style={{ fontSize: 12, color: '#4a5052', lineHeight: 1.55 }}>{e.reason}</span>}

              {e.actorUserId === null && (
                <span style={{ fontSize: 11, color: '#6d7577' }}>Registrado por el sistema</span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
