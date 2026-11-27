import { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ticketsApi, supportAgentsApi } from '../api/tickets.api';
import type { Client, Ticket, TicketStatus } from '../api/types';
import { clientsApi } from '../api/clients.api';
import { useRealtime } from '../lib/realtime';
import { toast } from '../ui/Toast';
import { STATUS_STYLES, PRIORITY_STYLES, STATUS_LABELS, slaBarColor } from './tickets/ticket-ui';
import NewTicketDialog from './tickets/NewTicketDialog';
import ChangeClientDialog from './tickets/ChangeClientDialog';
import ConcludeTicketsDialog, { ConcludeValues } from './tickets/ConcludeTicketsDialog';
import { useAuth } from '../auth/AuthContext';
import { canManageUsers } from '../auth/permissions';

type Chip = 'Todos' | 'Abiertos' | 'P1' | 'SLA en riesgo' | 'Archivados' | TicketStatus;

const CHIPS: Chip[] = [
  'Todos', 'Abiertos', 'P1', 'SLA en riesgo', 'DERIVADO', 'ESPERA_CLIENTE', 'RESUELTO', 'CERRADO', 'Archivados',
];

const STATUS_CHIPS: TicketStatus[] = ['DERIVADO', 'ESPERA_CLIENTE', 'RESUELTO', 'CERRADO'];

const chipLabel = (c: Chip): string =>
  (STATUS_CHIPS as string[]).includes(c) ? STATUS_LABELS[c as TicketStatus] : c;

const SEARCH_DEBOUNCE_MS = 280;

const BASE_COLUMNS = '82px 1fr 118px 96px 116px 110px 130px 84px';

const errMsg = (err: unknown): string | undefined =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message;

export default function TicketsListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Mover tickets de cliente es solo de ADMIN (igual que en el detalle).
  const isAdmin = canManageUsers(user);
  const GRID_COLUMNS = isAdmin ? `28px ${BASE_COLUMNS}` : BASE_COLUMNS;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Moviendo tickets…');
  const [concludeOpen, setConcludeOpen] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<Chip>('Todos');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usersById, setUsersById] = useState<Map<number, string>>(new Map());
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  // El cliente va en la URL (?cliente=9) para poder compartir o guardar la bandeja filtrada.
  const [searchParams, setSearchParams] = useSearchParams();
  const clientFilter = Number(searchParams.get('cliente')) || null;
  const [clients, setClients] = useState<Client[]>([]);
  const setClientFilter = (id: number | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('cliente', String(id));
    else next.delete('cliente');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    clientsApi
      .list()
      .then((list) => setClients([...list].sort((a, b) => a.razonSocial.localeCompare(b.razonSocial, 'es'))))
      .catch((e) => console.warn('[TicketsListPage] No se pudo cargar la lista de clientes para el filtro.', e));
  }, []);

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

  // Recarga en vivo: el backend avisa con `tickets:changed` cuando alguien
  // crea, mueve o archiva un ticket. La recarga es silenciosa (sin el
  // "Cargando…") para que la lista no parpadee mientras se mira.
  const [reloadTick, setReloadTick] = useState(0);
  const silentReload = useRef(false);
  const onChanged = useCallback(() => {
    silentReload.current = true;
    setReloadTick((n) => n + 1);
  }, []);
  useRealtime('tickets:changed', onChanged);

  // El filtrado va al backend: es donde vive la definición de "abierto" y de
  // "en riesgo", y así la bandeja no diverge del informe.
  // `cancelled` evita que una respuesta lenta y ya obsoleta (de un filtro o
  // búsqueda anteriores) pise el resultado de una más reciente.
  useEffect(() => {
    let cancelled = false;
    if (!silentReload.current) setLoading(true);
    silentReload.current = false;
    setError(null);
    ticketsApi
      .list({
        open: filter === 'Abiertos' ? true : undefined,
        priority: filter === 'P1' ? 'P1' : undefined,
        atRisk: filter === 'SLA en riesgo' ? true : undefined,
        status: (STATUS_CHIPS as string[]).includes(filter) ? (filter as TicketStatus) : undefined,
        // "Todos" es la bandeja de trabajo: lo cerrado tiene su propio filtro.
        excludeClosed: filter === 'Todos' ? true : undefined,
        archived: filter === 'Archivados' ? true : undefined,
        q: q || undefined,
        clientId: clientFilter ?? undefined,
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
  }, [filter, q, clientFilter, reloadTick]);

  const count = useMemo(() => tickets.length, [tickets]);

  // La selección solo vale para lo que se está viendo: al cambiar de filtro,
  // búsqueda o cliente se descarta, para no mover tickets que ya no están a la vista.
  useEffect(() => {
    setSelected(new Set());
  }, [filter, q, clientFilter]);

  const visibleSelected = tickets.filter((t) => selected.has(t.id));
  const allSelected = tickets.length > 0 && visibleSelected.length === tickets.length;

  const toggleOne = (e: MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(tickets.map((t) => t.id)));

  // Reusa POST /tickets/:id/client ticket por ticket: las mismas validaciones
  // que en el detalle. Uno que falle no detiene a los demás; al final se
  // informa cuáles no se movieron y quedan seleccionados para reintentar.
  const moveSelected = async (v: { clientId: number; systemId: number | null; clientUserId: number | null }) => {
    setMoveOpen(false);
    setBusyLabel('Moviendo tickets…');
    setMoving(true);
    const failed: { t: Ticket; msg: string }[] = [];
    let ok = 0;
    for (const t of visibleSelected) {
      try {
        await ticketsApi.changeClient(t.id, v);
        ok++;
      } catch (err) {
        failed.push({ t, msg: errMsg(err) ?? 'error' });
      }
    }
    setMoving(false);
    setSelected(new Set(failed.map((f) => f.t.id)));
    onChanged();
    if (ok) toast.success(`${ok} ticket${ok === 1 ? '' : 's'} movido${ok === 1 ? '' : 's'} de cliente`);
    if (failed.length) {
      const first = failed[0];
      toast.error(
        `${failed.length} no se movieron (siguen seleccionados). ${first.t.code ?? `#${first.t.id}`}: ${first.msg}`,
      );
    }
  };

  // Concluir en lote: POST /tickets/:id/conclude ticket por ticket, mismo
  // criterio que mover. Los cerrados ya no se pueden concluir y se saltan.
  const concludeSelected = async (v: ConcludeValues) => {
    setConcludeOpen(false);
    setBusyLabel('Concluyendo tickets…');
    setMoving(true);
    const failed: { t: Ticket; msg: string }[] = [];
    let ok = 0;
    for (const t of visibleSelected) {
      if (t.status === 'CERRADO') continue;
      try {
        await ticketsApi.conclude(t.id, v);
        ok++;
      } catch (err) {
        failed.push({ t, msg: errMsg(err) ?? 'error' });
      }
    }
    setMoving(false);
    setSelected(new Set(failed.map((f) => f.t.id)));
    onChanged();
    if (ok) toast.success(`${ok} ticket${ok === 1 ? '' : 's'} concluido${ok === 1 ? '' : 's'} (resuelto y cerrado)`);
    if (failed.length) {
      const first = failed[0];
      toast.error(
        `${failed.length} no se concluyeron (siguen seleccionados). ${first.t.code ?? `#${first.t.id}`}: ${first.msg}`,
      );
    }
  };

  // Se puede archivar en cualquier estado. Es reversible (filtro "Archivados"),
  // por eso no pide confirmación. Se quita de la lista al momento; el aviso en
  // vivo recarga igualmente las demás bandejas abiertas.
  const toggleArchive = async (e: MouseEvent, t: Ticket) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (t.archivedAt) await ticketsApi.unarchive(t.id);
      else await ticketsApi.archive(t.id);
      setTickets((list) => list.filter((x) => x.id !== t.id));
      toast.success(`${t.code ?? `#${t.id}`} ${t.archivedAt ? 'desarchivado' : 'archivado'}`);
    } catch (err) {
      toast.error(errMsg(err) ?? 'No se pudo actualizar el ticket');
    }
  };

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
          <select
            value={clientFilter ?? ''}
            onChange={(e) => setClientFilter(e.target.value ? Number(e.target.value) : null)}
            aria-label="Filtrar por cliente"
            style={{
              marginLeft: 'auto', fontSize: 12, padding: '6px 10px', borderRadius: 6, maxWidth: 220,
              border: `1px solid ${clientFilter ? '#15191a' : '#dfe3e4'}`, background: '#fff', color: '#3a4041',
            }}
          >
            <option value="">Todos los clientes</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.razonSocial}</option>
            ))}
          </select>
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Buscar por código, asunto o texto"
            aria-label="Buscar tickets por código, asunto o texto"
            style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #dfe3e4', borderRadius: 6, minWidth: 240 }}
          />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6d7577' }}>
            {count} tickets
          </span>
        </div>

        {isAdmin && (visibleSelected.length > 0 || moving) && (
          <div style={{ padding: '10px 18px', borderBottom: '1px solid #eceeef', background: '#f4f7f7', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ fontWeight: 600 }}>
              {moving ? busyLabel : `${visibleSelected.length} seleccionado${visibleSelected.length === 1 ? '' : 's'}`}
            </span>
            <button
              type="button"
              disabled={moving}
              onClick={() => setMoveOpen(true)}
              style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 6, border: 'none', background: moving ? '#c9cdce' : '#15191a', color: '#fff', cursor: moving ? 'not-allowed' : 'pointer' }}
            >
              Cambiar cliente
            </button>
            <button
              type="button"
              disabled={moving || visibleSelected.every((t) => t.status === 'CERRADO')}
              onClick={() => setConcludeOpen(true)}
              title="Resolver y cerrar los seleccionados con una observación general"
              style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 6, border: '1px solid #15191a', background: '#fff', color: '#15191a', cursor: moving ? 'not-allowed' : 'pointer' }}
            >
              Concluir
            </button>
            <button
              type="button"
              disabled={moving}
              onClick={() => setSelected(new Set())}
              style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid #dfe3e4', background: '#fff', color: '#3a4041', cursor: 'pointer' }}
            >
              Quitar selección
            </button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, gap: 12, padding: '10px 18px', borderBottom: '1px solid #eceeef', background: '#fafbfb', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6d7577' }}>
          {isAdmin && (
            <input
              type="checkbox"
              checked={allSelected}
              disabled={tickets.length === 0 || moving}
              onChange={toggleAll}
              aria-label="Seleccionar todos los tickets de la lista"
              style={{ margin: 0, cursor: 'pointer' }}
            />
          )}
          <span>Ticket</span><span>Asunto</span><span>Categoría</span>
          <span>Prior.</span><span>Estado</span><span>Asignado</span><span>SLA</span><span />
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
              style={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, gap: 12, alignItems: 'center', padding: '13px 18px', borderBottom: '1px solid #f1f3f3', cursor: 'pointer', color: 'inherit', textDecoration: 'none', background: selected.has(t.id) ? '#f4f7f7' : undefined }}
            >
              {isAdmin && (
                // La fila es un enlace: el clic en la casilla no debe abrir el ticket.
                <span onClick={(e) => !moving && toggleOne(e, t.id)} style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    readOnly
                    disabled={moving}
                    aria-label={`Seleccionar ${t.code ?? `ticket ${t.id}`}`}
                    style={{ margin: 0, cursor: 'pointer', pointerEvents: 'none' }}
                  />
                </span>
              )}
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
              <button
                type="button"
                onClick={(e) => toggleArchive(e, t)}
                title={t.archivedAt ? 'Devolver a la bandeja' : 'Quitar de la bandeja (reversible)'}
                style={{ justifySelf: 'end', cursor: 'pointer', fontSize: 11, fontWeight: 500, padding: '4px 9px', borderRadius: 6, border: '1px solid #dfe3e4', background: '#fff', color: '#3a4041' }}
              >
                {t.archivedAt ? 'Desarchivar' : 'Archivar'}
              </button>
            </Link>
          );
        })}
      </section>

      {isAdmin && (
        <ChangeClientDialog
          open={moveOpen}
          // La selección puede mezclar clientes: no se excluye ninguno de la lista.
          currentClientId={null}
          count={visibleSelected.length}
          onCancel={() => setMoveOpen(false)}
          onConfirm={moveSelected}
        />
      )}
      {isAdmin && (
        <ConcludeTicketsDialog
          open={concludeOpen}
          count={visibleSelected.filter((t) => t.status !== 'CERRADO').length}
          onCancel={() => setConcludeOpen(false)}
          onConfirm={concludeSelected}
        />
      )}

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
