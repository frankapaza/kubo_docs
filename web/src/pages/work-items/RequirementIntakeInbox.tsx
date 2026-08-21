import { useEffect, useMemo, useRef, useState } from 'react';

import { workItemsApi } from '../../api/work-items.api';
import { clientUsersApi } from '../../api/client-users.api';
import type { Client, WorkItem, WorkItemPriority } from '../../api/types';

export interface RequirementIntakeInboxProps {
  /** Empresas activas, ya cargadas por WorkItemsBoardPage: evita pedirlas dos veces. */
  clients: Client[];
  /**
   * Se llama tras aceptar o rechazar con éxito, para que el tablero de abajo
   * se entere: un aceptado entra a la columna PENDIENTE y deja de estar
   * SOLICITADO, así que la lista principal queda desactualizada si nadie la
   * refresca.
   */
  onChanged: () => void;
}

const PRIORITIES: WorkItemPriority[] = ['ALTA', 'MEDIA', 'BAJA'];

/**
 * La zona horaria del negocio, escrita aquí igual que `PERU_TIME_ZONE` en
 * `backend/src/common/time-zone.ts`: no hay forma de compartir la constante
 * entre los dos paquetes (front y back no comparten build), así que se
 * duplica el valor y no la idea. Si alguna vez cambia allá, tiene que
 * cambiar aquí también.
 */
const PERU_TIME_ZONE = 'America/Lima';

/**
 * "Hoy" tal como lo calcula `WorkItemIntakeService.assertFechaNoPasada`
 * (backend/src/modules/work-items/work-item-intake.service.ts): el backend
 * rechaza `committedDate` comparándolo contra la fecha civil en
 * `PERU_TIME_ZONE`, no contra la del navegador ni la del servidor.
 *
 * `new Date().toISOString()` daría la fecha en UTC, y a partir de las 19:00
 * de Lima el día en UTC ya es mañana: el selector de fecha, con ese mínimo,
 * dejaría de admitir "hoy" justo quien lo intenta a esa hora -- el mismo
 * defecto que ya mordió una vez en los correos (ver `PERU_TIME_ZONE`), pero
 * en la entrada en vez de en la pantalla.
 */
function hoyPeru(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PERU_TIME_ZONE }).format(new Date());
}

/** Fecha de alta: `createdAt` es una marca de tiempo real (con offset), no un `DATE` sin hora, así que `new Date(v)` no cae en la trampa de fmtDateOnly. */
function fmtAlta(v: string): string {
  return new Date(v).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

const inputStyle: React.CSSProperties = {
  fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6,
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 5, display: 'block' };

const dialogBackdropStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60,
};

const dialogPanelStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 22, width: 440, maxWidth: '92vw',
  display: 'flex', flexDirection: 'column', gap: 14,
};

const cancelButtonStyle: React.CSSProperties = {
  fontSize: 13, padding: '9px 14px', borderRadius: 7, background: '#fff',
  border: '1px solid #d8dcdd', cursor: 'pointer',
};

function confirmButtonStyle(ready: boolean): React.CSSProperties {
  return {
    fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7,
    background: ready ? '#15191a' : '#c9cdce', color: '#fff', border: 'none',
    cursor: ready ? 'pointer' : 'not-allowed',
  };
}

function errorBannerStyle(): React.CSSProperties {
  return {
    fontSize: 12, color: 'oklch(0.5 0.16 25)', background: 'oklch(0.96 0.02 25)',
    border: '1px solid oklch(0.88 0.05 25)', borderRadius: 6, padding: '8px 10px',
  };
}

interface AcceptDialogProps {
  item: WorkItem | null;
  onCancel: () => void;
  onAccepted: (updated: WorkItem) => void;
}

/**
 * Diálogo de aceptación: prioridad y fecha comprometida, las dos
 * obligatorias. Mismo idioma que MoveReasonDialog (role="dialog", Escape,
 * backdrop, stopPropagation en el panel), y el mismo freno síncrono contra
 * el doble envío que NewPortalRequirementDialog / los compositores del hilo.
 */
function AcceptDialog({ item, onCancel, onAccepted }: AcceptDialogProps) {
  // Sin valor por defecto: si arrancara en 'MEDIA', la prioridad nunca
  // podría faltar y "ambos obligatorios" se reduciría a mirar solo la
  // fecha. Quien acepta tiene que elegir la prioridad a propósito, porque
  // decide dónde cae el requerimiento en la columna PENDIENTE.
  const [priority, setPriority] = useState<WorkItemPriority | ''>('');
  const [committedDate, setCommittedDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Corta el camino tardío tras desmontar (la fila desaparece del listado en
  // cuanto se acepta, así que este diálogo puede desmontarse a mitad de la
  // llamada). Mismo motivo que en NewPortalRequirementDialog.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Guarda síncrona contra el doble envío: se marca antes de cualquier
   * `await`, con un `ref` y no con `useState` ni en un `useEffect`. `busy`
   * es asíncrono -- se aplica en el siguiente render -- así que un segundo
   * clic que llegue antes de ese render no lo vería. Este defecto ya produjo
   * altas duplicadas dos veces en este proyecto.
   */
  const inFlight = useRef(false);

  // Repone el formulario cada vez que se abre para un ítem nuevo.
  useEffect(() => {
    if (!item) return;
    setPriority('');
    setCommittedDate('');
    setError(null);
    setBusy(false);
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [item, busy, onCancel]);

  if (!item) return null;

  // Ambos obligatorios: ni la prioridad ni la fecha tienen un valor por
  // defecto que los dé por puestos.
  const canSubmit = priority !== '' && committedDate.length > 0;

  const submit = async () => {
    // La guarda, antes que nada y sin ningún `await` por delante.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await accept();
    } finally {
      inFlight.current = false;
    }
  };

  const accept = async () => {
    // Repetido en vez de reusar `canSubmit`: TS estrecha `priority` a
    // `WorkItemPriority` (sin `''`) apoyándose en esa condición alias, y
    // aquí hace falta la comprobación explícita para que el tipo del
    // argumento de `workItemsApi.accept` cierre sin un `as`.
    if (priority === '' || committedDate.length === 0) return;
    setBusy(true);
    // Limpia el error de un intento anterior antes de empezar este: dejar
    // uno sin limpiar mientras se reintenta es justo lo que una vez dejó un
    // éxito invisible y produjo un reenvío duplicado.
    setError(null);
    try {
      const updated = await workItemsApi.accept(item.id, { priority, committedDate });
      if (!alive.current) return;
      onAccepted(updated);
    } catch (e: any) {
      if (alive.current) {
        setError(e?.response?.data?.message ?? 'No se pudo aceptar el requerimiento.');
        setBusy(false);
      }
    }
  };

  const label = item.code ?? `requerimiento #${item.id}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="accept-wi-dialog-title"
      onClick={() => {
        if (!busy) onCancel();
      }}
      style={dialogBackdropStyle}
    >
      <div onClick={(e) => e.stopPropagation()} style={dialogPanelStyle}>
        <h2 id="accept-wi-dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Aceptar {label}
        </h2>
        <span style={{ fontSize: 12, color: '#6d7577', lineHeight: 1.4 }}>{item.title}</span>

        {error && (
          <div role="alert" style={errorBannerStyle()}>
            {error}
          </div>
        )}

        <label htmlFor="accept-wi-priority">
          <span style={labelStyle}>Prioridad *</span>
          <select
            id="accept-wi-priority"
            value={priority}
            disabled={busy}
            onChange={(e) => setPriority(e.target.value as WorkItemPriority | '')}
            style={inputStyle}
          >
            <option value="" disabled>
              Elige una prioridad…
            </option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>

        <label htmlFor="accept-wi-date">
          <span style={labelStyle}>Fecha comprometida *</span>
          <input
            id="accept-wi-date"
            type="date"
            value={committedDate}
            min={hoyPeru()}
            disabled={busy}
            onChange={(e) => setCommittedDate(e.target.value)}
            style={inputStyle}
          />
        </label>
        <span style={{ fontSize: 11, color: '#6d7577', marginTop: -8, lineHeight: 1.5 }}>
          La fecha se le mostrará al cliente en su portal.
        </span>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} disabled={busy} style={cancelButtonStyle}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !canSubmit}
            onClick={submit}
            style={confirmButtonStyle(!busy && canSubmit)}
          >
            {busy ? 'Aceptando…' : 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RejectDialogProps {
  item: WorkItem | null;
  onCancel: () => void;
  onRejected: (updated: WorkItem) => void;
}

/** Diálogo de rechazo: motivo obligatorio, mismo idioma que MoveReasonDialog. */
function RejectDialog({ item, onCancel, onRejected }: RejectDialogProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Mismo freno síncrono que AcceptDialog: `ref`, marcado antes del `await`. */
  const inFlight = useRef(false);

  useEffect(() => {
    if (!item) return;
    setReason('');
    setError(null);
    setBusy(false);
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [item, busy, onCancel]);

  if (!item) return null;

  // Guarda de vida: un motivo de solo espacios no debe poder enviarse.
  const canSubmit = reason.trim().length > 0;

  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await reject();
    } finally {
      inFlight.current = false;
    }
  };

  const reject = async () => {
    if (!canSubmit) return;
    setBusy(true);
    // Mismo criterio que AcceptDialog: el error de un intento anterior no
    // sobrevive al siguiente.
    setError(null);
    try {
      const updated = await workItemsApi.reject(item.id, { reason: reason.trim() });
      if (!alive.current) return;
      onRejected(updated);
    } catch (e: any) {
      if (alive.current) {
        setError(e?.response?.data?.message ?? 'No se pudo rechazar el requerimiento.');
        setBusy(false);
      }
    }
  };

  const label = item.code ?? `requerimiento #${item.id}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-wi-dialog-title"
      onClick={() => {
        if (!busy) onCancel();
      }}
      style={dialogBackdropStyle}
    >
      <div onClick={(e) => e.stopPropagation()} style={dialogPanelStyle}>
        <h2 id="reject-wi-dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Rechazar {label}
        </h2>
        <span style={{ fontSize: 12, color: '#6d7577', lineHeight: 1.4 }}>{item.title}</span>

        {error && (
          <div role="alert" style={errorBannerStyle()}>
            {error}
          </div>
        )}

        <label htmlFor="reject-wi-reason">
          <span style={labelStyle}>Motivo *</span>
          <textarea
            id="reject-wi-reason"
            value={reason}
            rows={3}
            autoFocus
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </label>
        <span style={{ fontSize: 11, color: '#6d7577', marginTop: -8, lineHeight: 1.5 }}>
          El cliente verá este motivo en su portal.
        </span>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} disabled={busy} style={cancelButtonStyle}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !canSubmit}
            onClick={submit}
            style={confirmButtonStyle(!busy && canSubmit)}
          >
            {busy ? 'Rechazando…' : 'Rechazar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Bandeja de requerimientos SOLICITADOS: lo que los clientes pidieron desde
 * el portal y todavía nadie de casa aceptó ni rechazó.
 *
 * Se pide con su propio filtro (`status=SOLICITADO`) y no se deriva de la
 * lista de WorkItemsBoardPage: esa lista deliberadamente no manda `status`
 * para que el reparto en columnas lo haga el cliente, pero si el usuario
 * filtra el tablero por prioridad o asignado, un SOLICITADO (que no tiene
 * asignado y siempre nace en MEDIA) desaparecería de esa lista sin que eso
 * signifique que ya se resolvió. La bandeja no debe depender de esos filtros.
 *
 * Se pinta **solo si hay al menos un solicitado**: una franja vacía
 * permanente enseña a ignorarla.
 */
export default function RequirementIntakeInbox({ clients, onChanged }: RequirementIntakeInboxProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Se pone en `true` cuando la primera carga termina, con éxito o con
   * error, y nunca vuelve a `false`. Hace falta para distinguir dos
   * momentos que (loading, items, error) por sí solos no distinguen:
   * "todavía no hay respuesta de la primera carga" (se oculta, sin
   * parpadeo) y "estoy recargando tras un error, con `items` igual de
   * vacío que antes" (no se oculta -- ahí vive el botón "Reintentar" que el
   * usuario acaba de pulsar). `load()` limpia `error` y pone `loading` en
   * `true` en el mismo manejador, así que en el primer render tras pulsar
   * "Reintentar" `error` ya es `null` e `items` sigue en `[]`: sin esta
   * marca, la condición de más abajo no puede diferenciar ese instante del
   * primer montaje, y el panel entero -- aviso, "Cargando…" y el propio
   * botón -- desaparece justo cuando se pulsa. No es un `useState`: cambia
   * dentro del mismo callback que ya dispara
   * `setLoading`/`setError`/`setItems`, así que no hace falta un render
   * propio para que quede al día a tiempo.
   */
  const settled = useRef(false);

  // Nombre de quien pidió cada requerimiento, resuelto por lote: el listado
  // de work items no lo trae (solo el id), así que se pide a
  // GET /client-users?clientId=… una vez por cada empresa distinta presente
  // en la bandeja. Se indexa por el id del usuario (globalmente único, no
  // por empresa), así que un único Map alcanza aunque haya varias empresas.
  const [requesterNames, setRequesterNames] = useState<Map<number, string>>(new Map());

  const [acceptTarget, setAcceptTarget] = useState<WorkItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WorkItem | null>(null);

  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c.razonSocial])), [clients]);

  const load = () => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    workItemsApi
      .list({ status: 'SOLICITADO' })
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.response?.data?.message ?? 'No se pudo cargar la bandeja de solicitados.');
        }
        console.warn('[RequirementIntakeInbox] Fallo al cargar los solicitados.', e);
      })
      .finally(() => {
        if (!cancelled) {
          settled.current = true;
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => load(), []);

  // Resuelve "quién lo pidió" por empresa distinta presente en la bandeja.
  // Un fallo aquí no es un fallo de la bandeja: la fila simplemente cae al
  // "Usuario #id" de más abajo, igual que el resto de resoluciones opcionales
  // de nombre en este módulo (ver assigneeLabel en WorkItemsBoardPage).
  useEffect(() => {
    const clientIds = Array.from(new Set(items.map((i) => i.clientId)));
    if (clientIds.length === 0) return;
    let cancelled = false;
    Promise.allSettled(clientIds.map((id) => clientUsersApi.listByClient(id))).then((results) => {
      if (cancelled) return;
      const map = new Map<number, string>();
      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const u of result.value) map.set(u.id, u.fullName);
        } else {
          console.warn('[RequirementIntakeInbox] No se pudo cargar los usuarios de una empresa.', result.reason);
        }
      }
      setRequesterNames(map);
    });
    return () => {
      cancelled = true;
    };
  }, [items]);

  const requesterLabel = (item: WorkItem): string => {
    if (item.createdByClientUserId == null) return 'Desconocido';
    return requesterNames.get(item.createdByClientUserId) ?? `Usuario #${item.createdByClientUserId}`;
  };

  const clientLabel = (item: WorkItem): string => clientsById.get(item.clientId) ?? `Cliente #${item.clientId}`;

  const handleAccepted = (updated: WorkItem) => {
    setAcceptTarget(null);
    setItems((prev) => prev.filter((i) => i.id !== updated.id));
    onChanged();
  };

  const handleRejected = (updated: WorkItem) => {
    setRejectTarget(null);
    setItems((prev) => prev.filter((i) => i.id !== updated.id));
    onChanged();
  };

  /**
   * Cuándo se oculta la franja entera. No es solo `!error && items.length
   * === 0` -- esa fue la versión que rompió "Reintentar" (ver `settled`
   * más arriba): tras pulsar el botón, `error` vuelve a `null` e `items`
   * sigue en `[]`, así que esa condición ocultaba el panel entero,
   * incluido el botón que se acababa de pulsar. Tampoco es `!loading &&
   * !error && items.length === 0` -- esa fue la versión anterior a esa, y
   * parpadeaba "Solicitados / 0 / Cargando…" en cada visita porque no
   * distinguía "primera carga en curso" de "recarga en curso".
   *
   * Se oculta solo sin error, sin nada que mostrar, y cuando además no
   * estamos en mitad de una recarga que ya tuvo una carga previa resuelta
   * -- es decir, cuando es la primera carga (`!settled.current`) o cuando
   * ya terminó de cargar (`!loading`). El caso que se deja fuera a
   * propósito es "ya hubo una carga resuelta, y `loading` volvió a `true`":
   * eso es pulsar "Reintentar" tras un error, y ahí el panel tiene que
   * seguir de pie con su "Cargando…", no desaparecer.
   */
  if (!error && items.length === 0 && (!settled.current || !loading)) return null;

  return (
    <section
      aria-label="Requerimientos solicitados, pendientes de aceptación"
      style={{ background: '#fff', border: '1px solid #e2e5e6', borderRadius: 10, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Solicitados</h2>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6d7577' }}>
          {items.length}
        </span>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'oklch(0.5 0.16 25)' }}>
          <span>{error}</span>
          <button
            type="button"
            onClick={load}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #d8dcdd', background: '#fff', cursor: 'pointer' }}
          >
            Reintentar
          </button>
        </div>
      )}

      {loading && <div style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</div>}

      {!loading && items.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#6d7577', fontSize: 11, fontWeight: 600 }}>
              <th style={{ padding: '6px 8px' }}>Código</th>
              <th style={{ padding: '6px 8px' }}>Título</th>
              <th style={{ padding: '6px 8px' }}>Empresa</th>
              <th style={{ padding: '6px 8px' }}>Pedido por</th>
              <th style={{ padding: '6px 8px' }}>Fecha de alta</th>
              <th style={{ padding: '6px 8px' }} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderTop: '1px solid #eceeef' }}>
                <td style={{ padding: '8px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                  {item.code ?? `#${item.id}`}
                </td>
                <td style={{ padding: '8px', fontWeight: 500 }}>{item.title}</td>
                <td style={{ padding: '8px' }}>{clientLabel(item)}</td>
                <td style={{ padding: '8px' }}>{requesterLabel(item)}</td>
                <td style={{ padding: '8px', color: '#6d7577' }}>{fmtAlta(item.createdAt)}</td>
                <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    onClick={() => setAcceptTarget(item)}
                    aria-label={`Aceptar ${item.code ?? `requerimiento #${item.id}`}`}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 6,
                      background: '#15191a', color: '#fff', border: 'none', cursor: 'pointer', marginRight: 6,
                    }}
                  >
                    Aceptar
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectTarget(item)}
                    aria-label={`Rechazar ${item.code ?? `requerimiento #${item.id}`}`}
                    style={{
                      fontSize: 12, fontWeight: 500, padding: '6px 11px', borderRadius: 6,
                      background: '#fff', color: '#3a4041', border: '1px solid #d8dcdd', cursor: 'pointer',
                    }}
                  >
                    Rechazar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AcceptDialog item={acceptTarget} onCancel={() => setAcceptTarget(null)} onAccepted={handleAccepted} />
      <RejectDialog item={rejectTarget} onCancel={() => setRejectTarget(null)} onRejected={handleRejected} />
    </section>
  );
}
