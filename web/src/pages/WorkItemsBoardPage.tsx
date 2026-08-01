import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { workItemsApi } from '../api/work-items.api';
import { clientsApi } from '../api/clients.api';
import { supportAgentsApi } from '../api/tickets.api';
import type {
  Client, SupportAgentView, WorkItem, WorkItemPriority, WorkItemStatus,
} from '../api/types';
import { BOARD_COLUMNS, STATUS_LABELS } from './work-items/workitem-ui';
import WorkItemCard from './work-items/WorkItemCard';

const SEARCH_DEBOUNCE_MS = 280;

const PRIORITIES: WorkItemPriority[] = ['ALTA', 'MEDIA', 'BAJA'];

/** BLOQUEADO y CANCELADO no son columnas: van en la franja plegable de abajo. */
const OUT_OF_FLOW_STATUSES: WorkItemStatus[] = ['BLOQUEADO', 'CANCELADO'];

type DueFilterValue = 'vencidos' | 'semana' | '';

const DUE_FILTERS: { value: DueFilterValue; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'vencidos', label: 'Vencidos' },
  { value: 'semana', label: 'Esta semana' },
];

export default function WorkItemsBoardPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const clientIdParam = searchParams.get('clientId') ?? '';
  const priorityParam = (searchParams.get('priority') ?? '') as WorkItemPriority | '';
  const assigneeIdParam = searchParams.get('assigneeId') ?? '';
  const dueFilterParam = (searchParams.get('dueFilter') ?? '') as DueFilterValue;
  const qParam = searchParams.get('q') ?? '';

  const [qInput, setQInput] = useState(qParam);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [agents, setAgents] = useState<SupportAgentView[]>([]);
  const [usersById, setUsersById] = useState<Map<number, string>>(new Map());
  const [openItem, setOpenItem] = useState<WorkItem | null>(null);
  const [outOfFlowOpen, setOutOfFlowOpen] = useState(false);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  // Clientes activos para el filtro. Un fallo aquí no rompe el tablero: el
  // filtro de cliente simplemente queda sin opciones.
  useEffect(() => {
    let cancelled = false;
    clientsApi
      .list({ status: 'CLIENT' })
      .then((data) => {
        if (!cancelled) setClients(data);
      })
      .catch((e) => {
        console.warn(
          '[WorkItemsBoardPage] No se pudo cargar la lista de clientes; el filtro de cliente quedará vacío.',
          e,
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mismo patrón que TicketsListPage: el nombre del asignado se resuelve con
  // GET /support-agents, no con GET /users, porque este último está
  // restringido a ADMIN/PRODUCT_OWNER/SCRUM_MASTER y dejaría a un técnico
  // viendo el id crudo en su propio tablero.
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
        console.warn(
          '[WorkItemsBoardPage] No se pudo cargar la lista de técnicos; el asignado mostrará el id crudo y el filtro quedará sin opciones.',
          e,
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce de la búsqueda: cada tecleo no dispara un request ni reescribe
  // la URL de inmediato.
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = qInput.trim();
      if (trimmed !== qParam) setParam('q', trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  // Si la URL cambia por fuera (atrás/adelante del navegador, enlace
  // compartido), el cuadro de búsqueda debe reflejarlo.
  useEffect(() => {
    setQInput(qParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam]);

  // El filtrado (cliente, prioridad, asignado, fecha, texto) va al backend.
  // Deliberadamente NO se manda status: el endpoint ya devuelve todo
  // ordenado por (status, board_order) y el reparto en columnas — incluida
  // la franja fuera de flujo — se hace aquí, en el cliente.
  // `cancelled` evita que una respuesta obsoleta pise un filtro más reciente.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    workItemsApi
      .list({
        clientId: clientIdParam ? Number(clientIdParam) : undefined,
        priority: priorityParam || undefined,
        assigneeId: assigneeIdParam ? Number(assigneeIdParam) : undefined,
        dueFilter: dueFilterParam || undefined,
        q: qParam || undefined,
      })
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.response?.data?.message ?? 'No se pudo cargar el tablero de requerimientos');
        }
        console.warn('[WorkItemsBoardPage] Fallo al cargar el tablero.', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientIdParam, priorityParam, assigneeIdParam, dueFilterParam, qParam]);

  const columns = useMemo(() => {
    const map = new Map<WorkItemStatus, WorkItem[]>(BOARD_COLUMNS.map((s) => [s, [] as WorkItem[]]));
    for (const item of items) {
      const bucket = map.get(item.status);
      if (bucket) bucket.push(item);
    }
    return map;
  }, [items]);

  const outOfFlowItems = useMemo(
    () => items.filter((i) => OUT_OF_FLOW_STATUSES.includes(i.status)),
    [items],
  );

  const assigneeLabel = (item: WorkItem): string =>
    item.assigneeUserId
      ? usersById.get(item.assigneeUserId) ?? String(item.assigneeUserId)
      : 'Sin asignar';

  // El movimiento real (arrastre nativo y menú «Mover a…» accesible por
  // teclado, contra workItemsApi.move) llega en la Tarea 10. Por ahora no hay
  // ningún control en la tarjeta que dispare esto; se deja wireado.
  const handleMove = (item: WorkItem) => {
    console.info(`[WorkItemsBoardPage] onMove(${item.code ?? item.id}): pendiente de la Tarea 10.`);
  };

  return (
    <div style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Requerimientos</h1>

      <section
        style={{
          background: '#fff', border: '1px solid #e2e5e6', borderRadius: 10,
          padding: '13px 18px', display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#6d7577' }}>
          Cliente
          <select
            value={clientIdParam}
            onChange={(e) => setParam('clientId', e.target.value)}
            aria-label="Filtrar por cliente"
            style={{ fontSize: 12, padding: '6px 8px', border: '1px solid #dfe3e4', borderRadius: 6 }}
          >
            <option value="">Todos</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.razonSocial}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#6d7577' }}>
          Prioridad
          <select
            value={priorityParam}
            onChange={(e) => setParam('priority', e.target.value)}
            aria-label="Filtrar por prioridad"
            style={{ fontSize: 12, padding: '6px 8px', border: '1px solid #dfe3e4', borderRadius: 6 }}
          >
            <option value="">Todas</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#6d7577' }}>
          Asignado
          <select
            value={assigneeIdParam}
            onChange={(e) => setParam('assigneeId', e.target.value)}
            aria-label="Filtrar por asignado"
            style={{ fontSize: 12, padding: '6px 8px', border: '1px solid #dfe3e4', borderRadius: 6 }}
          >
            <option value="">Todos</option>
            {agents.map((a) => (
              <option key={a.userId} value={a.userId}>{a.fullName}</option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', gap: 6 }}>
          {DUE_FILTERS.map((d) => (
            <button
              key={d.value || 'todos'}
              type="button"
              onClick={() => setParam('dueFilter', d.value)}
              aria-pressed={dueFilterParam === d.value}
              style={{
                cursor: 'pointer', fontSize: 12, fontWeight: 500, padding: '6px 12px', borderRadius: 16,
                border: `1px solid ${dueFilterParam === d.value ? '#15191a' : '#dfe3e4'}`,
                background: dueFilterParam === d.value ? '#15191a' : '#fff',
                color: dueFilterParam === d.value ? '#fff' : '#3a4041',
              }}
            >
              {d.label}
            </button>
          ))}
        </div>

        <input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Buscar por código o título"
          aria-label="Buscar requerimientos por código o título"
          style={{
            marginLeft: 'auto', fontSize: 12, padding: '7px 10px', border: '1px solid #dfe3e4',
            borderRadius: 6, minWidth: 220,
          }}
        />
      </section>

      {error && <div style={{ fontSize: 13, color: 'oklch(0.5 0.16 25)' }}>{error}</div>}
      {loading && <div style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {BOARD_COLUMNS.map((status) => {
          const columnItems = columns.get(status) ?? [];
          return (
            <section
              key={status}
              aria-label={`Columna ${STATUS_LABELS[status]}`}
              style={{
                background: '#f5f6f6', border: '1px solid #e2e5e6', borderRadius: 10, padding: 10,
                display: 'flex', flexDirection: 'column', gap: 8, minHeight: 220,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#15191a' }}>{STATUS_LABELS[status]}</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6d7577' }}>
                  {columnItems.length}
                </span>
              </div>
              {!loading && columnItems.length === 0 && (
                <div style={{ fontSize: 12, color: '#9aa1a2', padding: '8px 4px' }}>Sin ítems</div>
              )}
              {columnItems.map((item) => (
                <WorkItemCard
                  key={item.id}
                  item={item}
                  assigneeName={assigneeLabel(item)}
                  onOpen={(i) => setOpenItem(i)}
                  onMove={handleMove}
                />
              ))}
            </section>
          );
        })}
      </div>

      <section style={{ background: '#fff', border: '1px solid #e2e5e6', borderRadius: 10, overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setOutOfFlowOpen((v) => !v)}
          aria-expanded={outOfFlowOpen}
          aria-label="Mostrar u ocultar los ítems bloqueados y cancelados"
          style={{
            width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: '#15191a',
          }}
        >
          <span>Fuera de flujo — bloqueados y cancelados</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6d7577' }}>
            {outOfFlowItems.length} {outOfFlowOpen ? '▲' : '▼'}
          </span>
        </button>
        {outOfFlowOpen && (
          <div
            style={{
              padding: '0 16px 16px', display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10,
            }}
          >
            {outOfFlowItems.length === 0 && (
              <div style={{ fontSize: 12, color: '#9aa1a2' }}>No hay ítems bloqueados ni cancelados.</div>
            )}
            {outOfFlowItems.map((item) => (
              <WorkItemCard
                key={item.id}
                item={item}
                assigneeName={assigneeLabel(item)}
                onOpen={(i) => setOpenItem(i)}
                onMove={handleMove}
              />
            ))}
          </div>
        )}
      </section>

      {openItem && (
        <aside
          aria-label={`Detalle de ${openItem.code ?? openItem.id}`}
          style={{
            position: 'fixed', right: 20, bottom: 20, width: 320, background: '#fff',
            border: '1px solid #e2e5e6', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', padding: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <strong style={{ fontSize: 13 }}>
              {openItem.code ?? `#${openItem.id}`} — {openItem.title}
            </strong>
            <button
              type="button"
              onClick={() => setOpenItem(null)}
              aria-label="Cerrar detalle"
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#4a5052', margin: '8px 0 4px' }}>
            Estado: {STATUS_LABELS[openItem.status]} · Prioridad: {openItem.priority}
          </p>
          <p style={{ fontSize: 11, color: '#9aa1a2', margin: 0 }}>
            El panel completo (descripción, criterios de aceptación y timeline) llega en la Tarea 11.
          </p>
        </aside>
      )}
    </div>
  );
}
