import type { Ticket } from '../../api/types';
import { slaBarColor } from './ticket-ui';

export default function TicketSlaClock({ ticket }: { ticket: Ticket }) {
  const color = slaBarColor(ticket.slaPct, ticket.slaOverdue);

  return (
    <section style={{ background: '#fff', border: '1px solid #e2e5e6', borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Reloj de SLA</h2>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 26, fontWeight: 600, color }}>
          {ticket.slaLabel}
        </span>
        <span style={{ fontSize: 12, color: '#6d7577' }}>restante para resolución</span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: '#eceeef', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${ticket.slaPct ?? 0}%`, background: color }} />
      </div>
      <span style={{ fontSize: 11, color: '#6d7577', lineHeight: 1.5 }}>
        El reloj se pausa en «Espera cliente». Derivar no lo detiene ni lo reinicia.
      </span>
      {ticket.status === 'ESPERA_CLIENTE' && (
        <span style={{ fontSize: 11, fontWeight: 600, color: '#4a5052' }}>⏸ En pausa</span>
      )}
    </section>
  );
}
