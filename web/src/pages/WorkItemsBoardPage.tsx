import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useSearchParams } from 'react-router-dom';

import { workItemsApi } from '../api/work-items.api';
import { clientsApi } from '../api/clients.api';
import { supportAgentsApi } from '../api/tickets.api';
import type {
  Client, SupportAgentView, WorkItem, WorkItemPriority, WorkItemStatus,
} from '../api/types';
import { BOARD_COLUMNS, STATUS_LABELS } from './work-items/workitem-ui';
import MoveReasonDialog from './work-items/MoveReasonDialog';
import BoardColumn from './work-items/BoardColumn';
import type { DropTarget } from './work-items/BoardColumn';
import WorkItemPanel from './work-items/WorkItemPanel';
import NewWorkItemDialog from './work-items/NewWorkItemDialog';
import RequirementIntakeInbox from './work-items/RequirementIntakeInbox';
import { clientColor } from './work-items/client-colors';

/** El punto de color de cada columna del tablero. */
const COLUMN_DOTS: Partial<Record<WorkItemStatus, string>> = {
  PENDIENTE: '#94A3B8',
  EN_PROCESO: '#F59E0B',
  PRUEBAS: '#3B82F6',
  CERRADO: '#22A06B',
  BLOQUEADO: '#C2413A',
  CANCELADO: '#6B7280',
  RECHAZADO: '#9B1F52',
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: active ? 600 : 500, padding: '6px 12px', borderRadius: 999,
    border: `1px solid ${active ? 'var(--k-ink, #15191a)' : 'var(--k-border, #dfe3e4)'}`,
    background: active ? 'var(--k-ink, #15191a)' : '#fff',
    color: active ? '#fff' : 'var(--k-ink, #3a4041)',
  };
}

const SEARCH_DEBOUNCE_MS = 280;

const PRIORITIES: WorkItemPriority[] = ['ALTA', 'MEDIA', 'BAJA'];

/**
 * BLOQUEADO, CANCELADO y RECHAZADO no son columnas: van en la franja
 * plegable de abajo. Mismo conjunto que OUT_OF_FLOW_STATUSES en
 * backend/src/modules/work-items/domain/work-item-board.ts: sin RECHAZADO
 * aquí, un requerimiento rechazado desaparecía del tablero (el cliente lo ve
 * en el portal, pero la casa no lo volvía a encontrar en ninguna pantalla).
 */
const OUT_OF_FLOW_STATUSES: WorkItemStatus[] = ['BLOQUEADO', 'CANCELADO', 'RECHAZADO'];

type DueFilterValue = 'vencidos' | 'semana' | '';

const DUE_FILTERS: { value: DueFilterValue; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'vencidos', label: 'Vencidos' },
  { value: 'semana', label: 'Esta semana' },
];

/**
 * Índice de inserción dentro de `container` según la posición vertical del
 * puntero: compara `clientY` con el punto medio de cada tarjeta hija
 * (`[data-card-id]`). Se excluye la tarjeta que se está arrastrando —igual
 * que `reorder()` en el backend, que primero saca el ítem movido de la
 * columna y luego lo reinserta— para que el índice calculado aquí coincida
 * con el que espera `POST /work-items/:id/move`.
 */
function computeDropIndex(container: HTMLElement, clientY: number, excludeId: number | null): number {
  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-card-id]')).filter(
    (el) => Number(el.dataset.cardId) !== excludeId,
  );
  for (let i = 0; i < cards.length; i += 1) {
    const rect = cards[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return cards.length;
}

/**
 * Mismo algoritmo que `reorder()` en
 * backend/src/modules/work-items/domain/work-item-board.ts: saca `movedId`
 * de la columna y lo reinserta en `toIndex`. Se usa aquí solo para
 * previsualizar si un drop dentro de la misma columna cambiaría algo — si
 * el resultado es idéntico al orden actual, soltar la tarjeta sobre su
 * propio lugar no debe disparar ni la llamada a la API ni el refetch.
 */
function reorderPreview(columnIds: number[], movedId: number, toIndex: number): number[] {
  const without = columnIds.filter((id) => id !== movedId);
  const index = Math.max(0, Math.min(toIndex, without.length));
  return [...without.slice(0, index), movedId, ...without.slice(index)];
}

export default function WorkItemsBoardPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const clientIdParam = searchParams.get('clientId') ?? '';
  const priorityParam = (searchParams.get('priority') ?? '') as WorkItemPriority | '';
  const assigneeIdParam = searchParams.get('assigneeId') ?? '';
  const dueFilterParam = (searchParams.get('dueFilter') ?? '') as DueFilterValue;
  const qParam = searchParams.get('q') ?? '';
  const tab: 'bandeja' | 'tablero' = searchParams.get('tab') === 'tablero' ? 'tablero' : 'bandeja';
  const [inboxCount, setInboxCount] = useState<number | null>(null);
  const [boardClients, setBoardClients] = useState<Array<{ id: number; name: string; count: number }>>([]);

  const [qInput, setQInput] = useState(qParam);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [agents, setAgents] = useState<SupportAgentView[]>([]);
  const [usersById, setUsersById] = useState<Map<number, string>>(new Map());
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  // Sube cada vez que el panel cambia algo, para que la bandeja de
  // solicitados también se recargue (aceptar, pedir detalle desde el panel).
  const [inboxKey, setInboxKey] = useState(0);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [outOfFlowOpen, setOutOfFlowOpen] = useState(false);

  // Estado del arrastre nativo: qué tarjeta se mueve y dónde caería si se
  // soltara ahora. Puramente visual — el reacomodo real solo ocurre tras la
  // respuesta del servidor (ver performMove).
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // Movimiento pendiente de motivo: se llena al soltar (o elegir del menú)
  // un destino BLOQUEADO/CANCELADO, y solo entonces se abre el diálogo.
  const [pendingMove, setPendingMove] = useState<{ item: WorkItem; toStatus: WorkItemStatus; toIndex: number } | null>(null);

  // Red de seguridad para el foco: si tras un movimiento el refetch
  // recompone el tablero y el elemento que tenía el foco (el botón «Mover
  // a…» de la tarjeta) desaparece porque la tarjeta cambió de columna, el
  // navegador lo manda a <body> — quedarse "en ningún lado" para quien
  // navega por teclado. performMove revisa esto tras refrescar y, si pasó,
  // trae el foco aquí en vez de dejarlo perdido.
  const boardRef = useRef<HTMLDivElement>(null);

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

  // Parámetros de listado derivados de la URL. Se memoizan para poder
  // reusarlos tanto en el efecto de carga como en el refetch tras un
  // movimiento, sin duplicar la construcción del objeto.
  const listParams = useMemo(
    () => ({
      clientId: clientIdParam ? Number(clientIdParam) : undefined,
      priority: priorityParam || undefined,
      assigneeId: assigneeIdParam ? Number(assigneeIdParam) : undefined,
      dueFilter: dueFilterParam || undefined,
      q: qParam || undefined,
    }),
    [clientIdParam, priorityParam, assigneeIdParam, dueFilterParam, qParam],
  );

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
      .list(listParams)
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
  }, [listParams]);

  const columns = useMemo(() => {
    const map = new Map<WorkItemStatus, WorkItem[]>(BOARD_COLUMNS.map((s) => [s, [] as WorkItem[]]));
    for (const item of items) {
      const bucket = map.get(item.status);
      if (bucket) bucket.push(item);
    }
    return map;
  }, [items]);

  const outOfFlowByStatus = useMemo(() => {
    const map = new Map<WorkItemStatus, WorkItem[]>(OUT_OF_FLOW_STATUSES.map((s) => [s, [] as WorkItem[]]));
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

  /**
   * Recarga la lista con los filtros vigentes, sin tocar `loading` (que es
   * el spinner de la carga inicial/por filtro): la usan el panel de detalle
   * tras cambiar prioridad o asignado, y el alta de un ítem nuevo. Un fallo
   * aquí es un hecho distinto de un fallo al escribir el cambio que la
   * disparó — mismo criterio que performMove más abajo.
   */
  const refetchList = async () => {
    try {
      const data = await workItemsApi.list(listParams);
      setItems(data);
      setError(null);
    } catch (e) {
      setError('No se pudo actualizar el tablero. Recarga la página.');
      console.warn('[WorkItemsBoardPage] Fallo al refrescar el tablero.', e);
    }
  };

  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c.razonSocial])), [clients]);
  const clientLabel = (item: WorkItem): string =>
    clientsById.get(item.clientId) ?? `Cliente #${item.clientId}`;

  const boardCount = loading && items.length === 0
    ? null
    : items.filter((i) => BOARD_COLUMNS.includes(i.status)).length;

  // Los chips de cliente salen de lo que hay en el tablero SIN filtro de
  // cliente; con un cliente elegido se conservan los de antes, para poder
  // cambiar a otro sin volver a «Todos».
  useEffect(() => {
    if (clientIdParam || loading) return;
    const counts = new Map<number, number>();
    for (const i of items) {
      if (BOARD_COLUMNS.includes(i.status) || OUT_OF_FLOW_STATUSES.includes(i.status)) {
        counts.set(i.clientId, (counts.get(i.clientId) ?? 0) + 1);
      }
    }
    setBoardClients(
      Array.from(counts, ([id, count]) => ({ id, count, name: clientsById.get(id) ?? `Cliente #${id}` }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    );
  }, [items, clientIdParam, loading, clientsById]);

  const assigneeLabel = (item: WorkItem): string =>
    item.assigneeUserId
      ? usersById.get(item.assigneeUserId) ?? String(item.assigneeUserId)
      : 'Sin asignar';

  const columnLength = (status: WorkItemStatus): number =>
    items.filter((i) => i.status === status).length;

  /**
   * Ejecuta el movimiento contra el backend y, si se guardó, recarga la
   * lista completa: el servidor renumera la columna (y la de origen) y es
   * la única fuente de verdad — nunca se reordena localmente. Un fallo de
   * la escritura y un fallo del refresco posterior dejan mensajes
   * distintos: son hechos distintos para quien mira la pantalla.
   */
  const performMove = async (item: WorkItem, toStatus: WorkItemStatus, toIndex: number, reason?: string) => {
    try {
      await workItemsApi.move(item.id, { toStatus, toIndex, reason });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? `No se pudo mover ${item.code ?? `#${item.id}`}. Intenta de nuevo.`);
      console.warn('[WorkItemsBoardPage] Fallo al mover el ítem.', e);
      return;
    }
    try {
      const data = await workItemsApi.list(listParams);
      setItems(data);
      setError(null);
      // Deja que React confirme el DOM con la nueva lista antes de mirar
      // dónde quedó el foco: si el nodo enfocado (el botón «Mover a…» de
      // esta tarjeta) se desmontó porque la tarjeta cambió de columna, el
      // navegador ya lo habrá mandado a <body> para este punto.
      setTimeout(() => {
        if (document.activeElement === document.body) {
          boardRef.current?.focus();
        }
      }, 0);
    } catch (e) {
      setError('El movimiento se guardó, pero el tablero no se pudo actualizar y puede estar desactualizado. Recarga la página.');
      console.warn('[WorkItemsBoardPage] Fallo al refrescar el tablero tras mover un ítem.', e);
    }
  };

  /**
   * Punto de entrada único para ambos caminos (arrastre y menú «Mover
   * a…»): si el destino exige motivo (BLOQUEADO/CANCELADO), abre el
   * diálogo y solo llama a la API al confirmar; si no, mueve directo.
   *
   * Antes de eso, si el destino es la misma columna en la que ya está el
   * ítem, se previsualiza el resultado con el mismo algoritmo que usa el
   * backend (`reorderPreview`): si soltar ahí no cambia el orden (soltar la
   * tarjeta sobre su propio lugar), no hay nada que guardar ni que
   * refrescar — ni siquiera si el destino fuera BLOQUEADO/CANCELADO, porque
   * no hay movimiento real que justifique pedir un motivo.
   */
  const requestMove = (item: WorkItem, toStatus: WorkItemStatus, toIndex: number) => {
    if (item.status === toStatus) {
      const columnIds = items.filter((i) => i.status === toStatus).map((i) => i.id);
      const preview = reorderPreview(columnIds, item.id, toIndex);
      if (preview.length === columnIds.length && preview.every((id, idx) => id === columnIds[idx])) {
        return;
      }
    }
    if (OUT_OF_FLOW_STATUSES.includes(toStatus)) {
      setPendingMove({ item, toStatus, toIndex });
      return;
    }
    void performMove(item, toStatus, toIndex);
  };

  // Menú «Mover a…»: siempre al final de la columna de destino.
  const handleMoveFromMenu = (item: WorkItem, toStatus: WorkItemStatus) => {
    requestMove(item, toStatus, columnLength(toStatus));
  };

  const handleDragStartCard = (item: WorkItem) => setDraggingId(item.id);

  const handleDragEndCard = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  const handleColumnDragOver = (e: DragEvent<HTMLElement>, status: WorkItemStatus) => {
    // RECHAZADO no admite soltar nada encima: a ese estado solo se llega
    // rechazando desde la bandeja de aceptación (RequirementIntakeInbox),
    // porque ese es el único camino que escribe el evento REJECTED del que
    // depende `lastRejectionReason` (el motivo que ve el cliente en el
    // portal). Un arrastre hasta aquí escribiría un MOVED en su lugar —el
    // portal mostraría "Rechazado" con "Sin motivo registrado"— y encima el
    // ítem quedaría atrapado, porque assertMovable ya bloquea salir de
    // RECHAZADO y no hay pantalla que lo deshaga. Sin preventDefault() el
    // navegador rechaza la suelta antes de que llegue a handleColumnDrop.
    if (status === 'RECHAZADO') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const index = computeDropIndex(e.currentTarget, e.clientY, draggingId);
    setDropTarget({ status, index });
  };

  const handleColumnDragLeave = (e: DragEvent<HTMLElement>, status: WorkItemStatus) => {
    // Solo limpiar si el puntero de verdad salió del contenedor, no al
    // pasar por encima de una tarjeta hija (que también dispara dragleave).
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropTarget((prev) => (prev?.status === status ? null : prev));
  };

  const handleColumnDrop = (e: DragEvent<HTMLElement>, status: WorkItemStatus) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    const index = computeDropIndex(e.currentTarget, e.clientY, draggingId);
    setDropTarget(null);
    setDraggingId(null);
    const item = items.find((i) => i.id === id);
    if (!item) return;
    requestMove(item, status, index);
  };

  const handleCancelMoveReason = () => setPendingMove(null);

  const handleConfirmMoveReason = (reason: string) => {
    if (!pendingMove) return;
    const { item, toStatus, toIndex } = pendingMove;
    setPendingMove(null);
    void performMove(item, toStatus, toIndex, reason);
  };

  return (
    <div
      ref={boardRef}
      tabIndex={-1}
      aria-label="Tablero de requerimientos"
      style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Requerimientos</h1>
        <button
          type="button"
          onClick={() => setNewItemOpen(true)}
          aria-label="Crear nuevo requerimiento"
          style={{
            fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7,
            background: '#15191a', color: '#fff', border: 'none', cursor: 'pointer',
          }}
        >
          + Nuevo requerimiento
        </button>
      </div>

      <div role="tablist" aria-label="Vistas de requerimientos" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--k-border, #e2e5e6)' }}>
        {([
          { key: 'bandeja', label: 'Bandeja', count: inboxCount },
          { key: 'tablero', label: 'Tablero', count: boardCount },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setParam('tab', t.key === 'bandeja' ? '' : t.key)}
            style={{
              font: 'inherit', fontSize: 13, fontWeight: tab === t.key ? 700 : 500, padding: '10px 14px',
              background: 'none', border: 'none', cursor: 'pointer', marginBottom: -1,
              borderBottom: `2px solid ${tab === t.key ? 'var(--k-primary, #15191a)' : 'transparent'}`,
              color: tab === t.key ? 'var(--k-ink, #15191a)' : 'var(--k-muted, #6d7577)',
              display: 'inline-flex', alignItems: 'center', gap: 7,
            }}
          >
            {t.label}
            {t.count != null && (
              <span
                style={{
                  fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                  background: t.key === 'bandeja' && t.count > 0 ? 'var(--k-accent-soft, #e3ecfb)' : 'var(--k-column, #eef0f1)',
                  color: t.key === 'bandeja' && t.count > 0 ? 'var(--k-accent-ink, #1d4e9e)' : 'var(--k-muted, #6d7577)',
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/*
        La bandeja (solicitados y «falta información») se queda montada aunque
        se mire el tablero: así el número de la pestaña sigue al día.
      */}
      <div hidden={tab !== 'bandeja'}>
        <RequirementIntakeInbox
          clients={clients}
          onChanged={() => void refetchList()}
          onOpen={(i) => setOpenItemId(i.id)}
          refreshKey={inboxKey}
          onCount={setInboxCount}
        />
        {inboxCount === 0 && (
          <div
            style={{
              padding: '28px 18px', textAlign: 'center', fontSize: 13, color: 'var(--k-muted, #6d7577)',
              background: '#fff', border: '1px dashed var(--k-border, #dfe3e4)', borderRadius: 12,
            }}
          >
            No hay requerimientos por evaluar. Los nuevos pedidos del portal aparecerán aquí.
          </div>
        )}
      </div>

      {tab === 'tablero' && (
      <>
      <section
        style={{
          background: '#fff', border: '1px solid #e2e5e6', borderRadius: 10,
          padding: '13px 18px', display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap',
        }}
      >
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

      {/* Filtro por cliente: un chip de su color por cada cliente con algo en el tablero. */}
      <div role="group" aria-label="Filtrar por cliente" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--k-muted, #6d7577)', marginRight: 2 }}>Cliente</span>
        <button
          type="button"
          aria-pressed={!clientIdParam}
          onClick={() => setParam('clientId', '')}
          style={chipStyle(!clientIdParam)}
        >
          Todos
        </button>
        {boardClients.map((c) => {
          const active = clientIdParam === String(c.id);
          const color = clientColor(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={active}
              onClick={() => setParam('clientId', active ? '' : String(c.id))}
              style={{ ...chipStyle(active), display: 'inline-flex', alignItems: 'center', gap: 7 }}
            >
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: color.solid }} />
              {c.name}
              <span style={{ opacity: 0.7 }}>{c.count}</span>
            </button>
          );
        })}
      </div>

      {error && <div style={{ fontSize: 13, color: 'oklch(0.5 0.16 25)' }}>{error}</div>}
      {loading && <div style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
        {BOARD_COLUMNS.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            label={STATUS_LABELS[status]}
            dot={COLUMN_DOTS[status]}
            items={columns.get(status) ?? []}
            loading={loading}
            assigneeLabel={assigneeLabel}
            clientLabel={clientLabel}
            onOpen={(i) => setOpenItemId(i.id)}
            onMove={handleMoveFromMenu}
            draggingId={draggingId}
            dropTarget={dropTarget}
            onDragStartCard={handleDragStartCard}
            onDragEndCard={handleDragEndCard}
            onColumnDragOver={handleColumnDragOver}
            onColumnDragLeave={handleColumnDragLeave}
            onColumnDrop={handleColumnDrop}
          />
        ))}
      </div>

      <section style={{ background: '#fff', border: '1px solid #e2e5e6', borderRadius: 10, overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setOutOfFlowOpen((v) => !v)}
          aria-expanded={outOfFlowOpen}
          aria-label="Mostrar u ocultar los ítems bloqueados, cancelados y rechazados"
          style={{
            width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: '#15191a',
          }}
        >
          <span>Fuera de flujo — bloqueados, cancelados y rechazados</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6d7577' }}>
            {outOfFlowItems.length} {outOfFlowOpen ? '▲' : '▼'}
          </span>
        </button>
        {outOfFlowOpen && (
          <div
            style={{
              padding: '0 16px 16px', display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
            }}
          >
            {OUT_OF_FLOW_STATUSES.map((status) => (
              <BoardColumn
                key={status}
                status={status}
                label={STATUS_LABELS[status]}
                items={outOfFlowByStatus.get(status) ?? []}
                loading={loading}
                assigneeLabel={assigneeLabel}
                clientLabel={clientLabel}
                onOpen={(i) => setOpenItemId(i.id)}
                onMove={handleMoveFromMenu}
                draggingId={draggingId}
                dropTarget={dropTarget}
                onDragStartCard={handleDragStartCard}
                onDragEndCard={handleDragEndCard}
                onColumnDragOver={handleColumnDragOver}
                onColumnDragLeave={handleColumnDragLeave}
                onColumnDrop={handleColumnDrop}
                minHeight={120}
              />
            ))}
          </div>
        )}
      </section>
      </>
      )}

      {openItemId !== null && (
        <WorkItemPanel
          workItemId={openItemId}
          onClose={() => setOpenItemId(null)}
          onChanged={() => {
            void refetchList();
            setInboxKey((k) => k + 1);
          }}
        />
      )}

      <NewWorkItemDialog
        open={newItemOpen}
        onCancel={() => setNewItemOpen(false)}
        onCreated={(created) => {
          setNewItemOpen(false);
          void refetchList();
          setOpenItemId(created.id);
        }}
      />

      <MoveReasonDialog
        open={pendingMove !== null}
        toStatus={pendingMove?.toStatus ?? null}
        onCancel={handleCancelMoveReason}
        onConfirm={handleConfirmMoveReason}
      />
    </div>
  );
}
