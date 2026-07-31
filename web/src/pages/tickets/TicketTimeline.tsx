import type { TicketEvent, TicketEventType } from '../../api/types';
import { TIMELINE_EVENT_DOTS } from './ticket-ui';

const EVENT_LABELS: Record<TicketEventType, string> = {
  CREATED: 'Ticket creado',
  TRIAGED: 'Triaje IA',
  ASSIGNED: 'Asignado',
  TAKEN: 'Tomado por el técnico',
  STATUS_CHANGED: 'Cambio de estado',
  ESCALATED: 'Derivado',
  COMMENT: 'Comentario',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
  REOPENED: 'Reabierto',
  SLA_AT_RISK: 'SLA en riesgo',
  PRIORITY_OVERRIDDEN: 'Prioridad ajustada',
};

export default function TicketTimeline({ events }: { events: TicketEvent[] }) {
  if (events.length === 0) {
    return <span style={{ fontSize: 12, color: '#6d7577' }}>Sin eventos todavía.</span>;
  }

  return (
    <>
      {events.map((e) => (
        <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: TIMELINE_EVENT_DOTS[e.type] ?? 'oklch(0.6 0.13 78)', marginTop: 5 }} />
            <span style={{ flex: 1, width: 1, background: '#e6e9e9' }} />
          </div>
          <div style={{ paddingBottom: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{EVENT_LABELS[e.type]}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6d7577' }}>
                {new Date(e.createdAt).toLocaleString('es-PE')}
              </span>
            </div>
            {e.fromStatus && e.toStatus && (
              <span style={{ fontSize: 12, color: '#4a5052' }}>
                {e.fromStatus} → {e.toStatus}
              </span>
            )}
            {e.reason && (
              <span style={{ fontSize: 12, color: '#4a5052', lineHeight: 1.55 }}>{e.reason}</span>
            )}
            {e.actorUserId === null && (
              <span style={{ fontSize: 11, color: '#6d7577' }}>Registrado por el sistema</span>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
