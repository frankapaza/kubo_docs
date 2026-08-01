import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ticketsApi, supportAgentsApi } from '../api/tickets.api';
import type { Ticket, TicketStatus } from '../api/types';
import { STATUS_STYLES, PRIORITY_STYLES, STATUS_LABELS, slaBarColor } from './tickets/ticket-ui';
import NewTicketDialog from './tickets/NewTicketDialog';

type Chip = 'Todos' | 'Abiertos' | 'P1' | 'SLA en riesgo' | TicketStatus;

const CHIPS: Chip[] = ['Todos', 'Abiertos', 'P1', 'SLA en riesgo', 'DERIVADO', 'ESPERA_CLIENTE', 'RESUELTO'];

const chipLabel = (c: Chip): string =>
  c === 'Todos' || c === 'Abiertos' || c === 'P1' || c === 'SLA en riesgo'
    ? c
    : STATUS_LABELS[c];

const SEARCH_DEBOUNCE_MS = 280;

export default function TicketsListPage() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<Chip>('Todos');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usersById, setUsersById] = useState<Map<number, string>>(new Map());
  const [newTicketOpen, setNewTicketOpen] = useState(false);

  // Resuelve assigneeUserId -> nombre a partir de GET /support-agents, que
  // no tiene restricción de rol (a diferencia de GET /users, reservado a
  // ADMIN/PRODUCT_OWNER/SCRUM_MASTER — un técnico DEVELOPER, el usuario
  // principal de la mesa de servicio, no podía verlo y la columna le caía
  // siempre al id crudo). Todo assigneeUserId de un ticket es un técnico
  // registrado, así que esta fuente cubre el mismo universo.
  useEffect(() => {
    supportAgentsApi
      .list()
      .then((list) => setUsersById(new Map(list.map((a) => [a.userId, a.fullName]))))
      .catch((e) => {
        console.warn(
          '[TicketsListPage] No se pudo cargar la lista de técnicos; la columna "Asignado" mostrará el id crudo.',
          e,
        );
      });
  }, []);

  // Debounce de la búsqueda: cada tecleo no debe disparar un request.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [qInput]);

  // El filtrado va al backend: es donde vive la definición de "abierto" y de
  // "en riesgo", y así la bandeja no diverge del informe.
  // `cancelled` evita que una respuesta lenta y ya obsoleta (de un filtro o
  // búsqueda anteriores) pise el resultado de una más reciente.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    ticketsApi
      .list({
        open: filter === 'Abiertos' ? true : undefined,
        priority: filter === 'P1' ? 'P1' : undefined,
        atRisk: filter === 'SLA en riesgo' ? true : undefined,
        status: ['DERIVADO', 'ESPERA_CLIENTE', 'RESUELTO'].includes(filter as string)
          ? (filter as TicketStatus)
          : undefined,
        q: q || undefined,
      })
      .then((data) => {
        if (!cancelled) setTickets(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.message ?? 'No se pudo cargar la bandeja');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, q]);

  const count = useMemo(() => tickets.length, [tickets]);

  return (
    <div style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Mesa de servicio</h1>
        <button
          type="button"
          onClick={() => setNewTicketOpen(true)}
          style={{ fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: '#15191a', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          + Nuevo ticket
        </button>
      </div>

      <section style={{ background: '#fff', border: '1px solid #e2e5e6', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '13px 18px', borderBottom: '1px solid #eceeef', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {CHIPS.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              aria-pressed={filter === c}
              style={{
                cursor: 'pointer', fontSize: 12, fontWeight: 500, padding: '6px 12px',
                borderRadius: 16,
                border: `1px solid ${filter === c ? '#15191a' : '#dfe3e4'}`,
                background: filter === c ? '#15191a' : '#fff',
                color: filter === c ? '#fff' : '#3a4041',
              }}
            >
              {chipLabel(c)}
            </button>
          ))}
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Buscar por código, asunto o texto"
            aria-label="Buscar tickets por código, asunto o texto"
            style={{ marginLeft: 'auto', fontSize: 12, padding: '6px 10px', border: '1px solid #dfe3e4', borderRadius: 6, minWidth: 240 }}
          />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6d7577' }}>
            {count} tickets
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr 118px 96px 116px 110px 130px', gap: 12, padding: '10px 18px', borderBottom: '1px solid #eceeef', background: '#fafbfb', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6d7577' }}>
          <span>Ticket</span><span>Asunto</span><span>Categoría</span>
          <span>Prior.</span><span>Estado</span><span>Asignado</span><span>SLA</span>
        </div>

        {loading && <div style={{ padding: 18, fontSize: 13, color: '#6d7577' }}>Cargando…</div>}
        {error && <div style={{ padding: 18, fontSize: 13, color: 'oklch(0.5 0.16 25)' }}>{error}</div>}
        {!loading && !error && tickets.length === 0 && (
          <div style={{ padding: 18, fontSize: 13, color: '#6d7577' }}>
            No hay tickets que coincidan con el filtro.
          </div>
        )}

        {tickets.map((t) => {
          const st = STATUS_STYLES[t.status];
          const pr = PRIORITY_STYLES[t.priority];
          const assigneeLabel = t.assigneeUserId
            ? usersById.get(t.assigneeUserId) ?? String(t.assigneeUserId)
            : '—';
          return (
            <Link
              key={t.id}
              to={`/tickets/${t.id}`}
              style={{ display: 'grid', gridTemplateColumns: '82px 1fr 118px 96px 116px 110px 130px', gap: 12, alignItems: 'center', padding: '13px 18px', borderBottom: '1px solid #f1f3f3', cursor: 'pointer', color: 'inherit', textDecoration: 'none' }}
            >
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#6d7577' }}>{t.code}</span>
              <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.subject ?? t.rawText.slice(0, 80)}
              </span>
              <span style={{ fontSize: 12, color: '#4a5052' }}>{t.serviceCategory ?? '—'}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, justifySelf: 'start', padding: '2px 7px', borderRadius: 4, background: pr.bg, color: pr.fg }}>
                {t.priority}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, justifySelf: 'start', padding: '3px 8px', borderRadius: 4, background: st.bg, color: st.fg }}>
                {STATUS_LABELS[t.status]}
              </span>
              <span style={{ fontSize: 12, color: '#4a5052' }}>{assigneeLabel}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 5, borderRadius: 3, background: '#eceeef' }}>
                  <div style={{ height: '100%', width: `${t.slaPct ?? 0}%`, background: slaBarColor(t.slaPct, t.slaOverdue), borderRadius: 3 }} />
                </div>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#6d7577' }}>{t.slaLabel}</span>
              </div>
            </Link>
          );
        })}
      </section>

      <NewTicketDialog
        open={newTicketOpen}
        onCancel={() => setNewTicketOpen(false)}
        onCreated={(created) => {
          setNewTicketOpen(false);
          // Ir directo al detalle: es donde siguen el triaje, la asignación
          // y el resto del ciclo de vida.
          navigate(`/tickets/${created.id}`);
        }}
      />
    </div>
  );
}
