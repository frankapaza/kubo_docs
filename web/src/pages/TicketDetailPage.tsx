import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ticketsApi, supportAgentsApi } from '../api/tickets.api';
import { clientsApi } from '../api/clients.api';
import type { TicketDetail, TicketRequestType, TicketStatus } from '../api/types';
import { STATUS_STYLES, PRIORITY_STYLES, STATUS_LABELS, ORIGIN_LABELS } from './tickets/ticket-ui';
import TicketTimeline from './tickets/TicketTimeline';
import TicketSlaClock from './tickets/TicketSlaClock';
import ResolveDialog from './tickets/ResolveDialog';
import AssignDialog from './tickets/AssignDialog';
import OverridePriorityDialog from './tickets/OverridePriorityDialog';
import TicketThread from './tickets/thread/TicketThread';

// Mismos seis estados que OPEN_STATUSES en
// backend/src/modules/tickets/domain/ticket-state-machine.ts (no importable
// desde el backend): triaje, asignación y ajuste de prioridad son acciones
// de gestión válidas mientras el ticket sigue abierto; dejan de tener
// sentido una vez resuelto o cerrado.
const OPEN_STATUSES: TicketStatus[] = ['NUEVO', 'TRIAJE', 'ASIGNADO', 'EN_ATENCION', 'ESPERA_CLIENTE', 'DERIVADO'];

const REQUEST_TYPE_LABELS: Record<TicketRequestType, string> = {
  INCIDENCIA: 'Incidencia',
  BUG: 'Bug',
  MEJORA: 'Mejora',
  FEATURE: 'Nueva funcionalidad',
  AJUSTE: 'Ajuste',
};

function fmt(v: string | null): string {
  return v ? new Date(v).toLocaleString('es-PE') : '—';
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e5e6',
  borderRadius: 10,
  padding: 18,
};

const actionButtonStyle = (variant: 'primary' | 'secondary' = 'secondary'): React.CSSProperties => ({
  fontSize: 13,
  fontWeight: 600,
  padding: '9px 14px',
  borderRadius: 7,
  border: variant === 'primary' ? 'none' : '1px solid #d8dcdd',
  background: variant === 'primary' ? '#15191a' : '#fff',
  color: variant === 'primary' ? '#fff' : '#3a4041',
  cursor: 'pointer',
  textAlign: 'left',
});

export default function TicketDetailPage() {
  const { ticketId } = useParams();
  const id = Number(ticketId);

  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [usersById, setUsersById] = useState<Map<number, string>>(new Map());
  const [clientName, setClientName] = useState<string | null>(null);

  // Resuelve assigneeUserId -> nombre a partir de GET /support-agents, sin
  // restricción de rol (ver TicketsListPage: GET /users sí la tiene y dejaba
  // a un técnico DEVELOPER viendo el id crudo).
  useEffect(() => {
    supportAgentsApi
      .list()
      .then((list) => setUsersById(new Map(list.map((a) => [a.userId, a.fullName]))))
      .catch((e) => {
        console.warn(
          '[TicketDetailPage] No se pudo cargar la lista de técnicos; la ficha mostrará ids crudos.',
          e,
        );
      });
  }, []);

  // `cancelled` evita que una carga obsoleta (tras navegar rápido entre
  // tickets) pise el estado de la vista actual.
  useEffect(() => {
    if (!Number.isFinite(id)) {
      // Id de ruta no numérico (URL manual, enlace obsoleto): sin este corte
      // explícito `loading` se queda en `true` para siempre, porque nunca se
      // dispara ni el `.then` ni el `.catch` de abajo.
      setLoading(false);
      setLoadError('Ticket no encontrado');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    ticketsApi
      .findOne(id)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e?.response?.data?.message ?? 'No se pudo cargar el ticket');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const clientId = detail?.ticket.clientId ?? null;
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
          console.warn('[TicketDetailPage] No se pudo cargar el cliente del ticket.', e);
          setClientName(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const reload = () => ticketsApi.findOne(id).then(setDetail);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'La acción no se pudo completar');
    } finally {
      setBusy(false);
    }
  };

  const escalate = () => {
    const reason = window.prompt('Motivo de la derivación (obligatorio):');
    if (!reason?.trim()) return; // el backend también lo rechaza; evitamos el viaje
    act(() => ticketsApi.escalate(id, { toLevel: 'N3', reason }));
  };

  // El «Historial» es el registro de lo que le pasó al ticket; la conversación
  // tiene su propia tarjeta justo encima (ver el docblock de TicketThread, con
  // el porqué de tenerlas separadas). Un `MESSAGE_POSTED` aquí sería la misma
  // línea contada dos veces y, como las notas internas también escriben el
  // suyo, dejaría en el historial una cuenta de cuántas hubo sin decir nada de
  // ellas.
  const lifecycleEvents = useMemo(
    () => (detail?.timeline ?? []).filter((e) => e.type !== 'MESSAGE_POSTED'),
    [detail],
  );

  if (loading) {
    return <div style={{ padding: 26, fontSize: 13, color: '#6d7577' }}>Cargando…</div>;
  }
  if (loadError || !detail) {
    return (
      <div style={{ padding: 26, fontSize: 13, color: 'oklch(0.5 0.16 25)' }}>
        {loadError ?? 'Ticket no encontrado'}
      </div>
    );
  }

  // El `timeline` no se desestructura: al historial va `lifecycleEvents`, que
  // es el mismo sin los `MESSAGE_POSTED`.
  const { ticket } = detail;
  const st = STATUS_STYLES[ticket.status];
  const pr = PRIORITY_STYLES[ticket.priority];

  // Los tres endpoints que respaldan estos botones validan la transición con
  // assertTransition() antes de escribir nada (ver
  // backend/src/modules/tickets/domain/ticket-state-machine.ts). Estas
  // condiciones reflejan exactamente esa tabla para no ofrecer en la UI una
  // transición que el backend va a rechazar:
  //   - take() solo tiene éxito desde ASIGNADO, ESPERA_CLIENTE, DERIVADO o
  //     RESUELTO (assertTransition(current.status, 'EN_ATENCION')). Se excluye
  //     ESPERA_CLIENTE porque ya tiene su propio botón "Reanudar" (más abajo,
  //     que no reasigna al técnico), y RESUELTO porque esa transición es una
  //     reapertura que exige `reason` (isReopen) y take() no lo envía.
  //   - escalate() exige assertTransition(current.status, 'DERIVADO'), que
  //     solo vale desde ASIGNADO o EN_ATENCION.
  //   - "Esperar cliente" y "Resolver" pasan por transition(), válido según
  //     la misma tabla desde EN_ATENCION (espera) y EN_ATENCION/ESPERA_CLIENTE
  //     (resolver).
  //   - "Cerrar" solo se ofrece tras resolver (RESUELTO → CERRADO); otros
  //     orígenes válidos hacia CERRADO (cancelación sin resolver) quedan
  //     fuera del alcance de esta tarea.
  const canTake = ['ASIGNADO', 'DERIVADO'].includes(ticket.status);
  const canWait = ticket.status === 'EN_ATENCION';
  const canResume = ticket.status === 'ESPERA_CLIENTE';
  const canEscalate = ['ASIGNADO', 'EN_ATENCION'].includes(ticket.status);
  const canResolve = ['EN_ATENCION', 'ESPERA_CLIENTE'].includes(ticket.status);
  const canClose = ticket.status === 'RESUELTO';
  // triage() y assign() no llaman a assertTransition para el propio patch
  // (solo la transición de estado que delegan, cuando aplica, la valida
  // aparte — ver TicketAIService.triage / TicketAssignmentService.assign).
  // Gating aquí por OPEN_STATUSES: no tiene sentido re-triar ni reasignar un
  // ticket ya resuelto o cerrado, aunque el backend no lo prohíba.
  const canTriage = OPEN_STATUSES.includes(ticket.status);
  const canAssign = OPEN_STATUSES.includes(ticket.status);
  const canOverridePriority = OPEN_STATUSES.includes(ticket.status);
  // Precondiciones exactas de TicketAIService.pushToJira: ya estructurado
  // (subject + descriptionMd), con proyecto, y sin enviar todavía (si ya
  // tiene jiraIssueKey, el backend respondería CONFLICT).
  const canPushToJira = Boolean(
    ticket.subject && ticket.descriptionMd && ticket.projectId && !ticket.jiraIssueKey,
  );
  const hasActions =
    canTake || canWait || canResume || canEscalate || canResolve || canClose ||
    canTriage || canAssign || canOverridePriority || canPushToJira;

  return (
    <div style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Link to="/tickets" style={{ fontSize: 12, color: '#6d7577', textDecoration: 'none' }}>
        ← Volver a tickets
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: '#6d7577' }}>
          {ticket.code ?? `#${ticket.id}`}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 4, background: st.bg, color: st.fg }}>
          {STATUS_LABELS[ticket.status]}
        </span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: pr.bg, color: pr.fg }}>
          {ticket.priority}
        </span>
        <span style={{ fontSize: 12, color: '#6d7577', marginLeft: 'auto' }}>
          Creado el {fmt(ticket.createdAt)}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 316px', gap: 18, alignItems: 'start' }}>
        {/* Columna izquierda */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <section style={cardStyle}>
            <h1 style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 600 }}>
              {ticket.subject ?? '(sin asunto)'}
            </h1>
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                fontSize: 13,
                lineHeight: 1.6,
                color: '#3a4041',
                background: '#fafbfb',
                border: '1px solid #eceeef',
                borderRadius: 8,
                padding: 12,
              }}
            >
              {ticket.rawText}
            </pre>
          </section>

          {(ticket.resolutionMd || ticket.rootCause || ticket.correctiveAction) && (
            <section style={cardStyle}>
              <h2 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600 }}>Solución</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {ticket.resolutionMd && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#6d7577', marginBottom: 3 }}>
                      Solución aplicada
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ticket.resolutionMd}</div>
                  </div>
                )}
                {ticket.rootCause && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#6d7577', marginBottom: 3 }}>
                      Causa raíz
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ticket.rootCause}</div>
                  </div>
                )}
                {ticket.correctiveAction && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#6d7577', marginBottom: 3 }}>
                      Acción correctiva / preventiva
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ticket.correctiveAction}</div>
                  </div>
                )}
              </div>
            </section>
          )}

          <TicketThread
            ticketId={id}
            ticketStatus={ticket.status}
            clientId={clientId}
            clientName={clientName}
            staffNamesById={usersById}
          />

          <section style={cardStyle}>
            <h2 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600 }}>Historial</h2>
            <TicketTimeline events={lifecycleEvents} />
          </section>
        </div>

        {/* Columna derecha */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section style={cardStyle}>
            <h2 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600 }}>Acciones</h2>
            {error && (
              <div
                style={{
                  fontSize: 12,
                  color: 'oklch(0.5 0.16 25)',
                  background: 'oklch(0.96 0.02 25)',
                  border: '1px solid oklch(0.88 0.05 25)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  marginBottom: 10,
                }}
                role="alert"
              >
                {error}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {canAssign && (
                <button disabled={busy} onClick={() => setAssignOpen(true)} style={actionButtonStyle()}>
                  {ticket.assigneeUserId ? 'Reasignar' : 'Asignar'}
                </button>
              )}
              {canTriage && (
                <button disabled={busy} onClick={() => act(() => ticketsApi.triage(id))} style={actionButtonStyle()}>
                  Triaje IA
                </button>
              )}
              {canTake && (
                <button disabled={busy} onClick={() => act(() => ticketsApi.take(id))} style={actionButtonStyle()}>
                  Tomar
                </button>
              )}
              {canWait && (
                <button
                  disabled={busy}
                  onClick={() => act(() => ticketsApi.transition(id, { toStatus: 'ESPERA_CLIENTE' }))}
                  style={actionButtonStyle()}
                >
                  Esperar cliente
                </button>
              )}
              {canResume && (
                <button
                  disabled={busy}
                  onClick={() => act(() => ticketsApi.transition(id, { toStatus: 'EN_ATENCION' }))}
                  style={actionButtonStyle()}
                >
                  Reanudar
                </button>
              )}
              {canEscalate && (
                <button disabled={busy} onClick={escalate} style={actionButtonStyle()}>
                  Derivar
                </button>
              )}
              {canResolve && (
                <button disabled={busy} onClick={() => setResolveOpen(true)} style={actionButtonStyle('primary')}>
                  Resolver
                </button>
              )}
              {canClose && (
                <button
                  disabled={busy}
                  onClick={() => act(() => ticketsApi.transition(id, { toStatus: 'CERRADO' }))}
                  style={actionButtonStyle('primary')}
                >
                  Cerrar
                </button>
              )}
              {canOverridePriority && (
                <button disabled={busy} onClick={() => setPriorityOpen(true)} style={actionButtonStyle()}>
                  Ajustar prioridad
                </button>
              )}
              {canPushToJira && (
                <button disabled={busy} onClick={() => act(() => ticketsApi.pushToJira(id))} style={actionButtonStyle()}>
                  Enviar a Jira
                </button>
              )}
              {!hasActions && (
                <span style={{ fontSize: 12, color: '#6d7577' }}>
                  No hay acciones disponibles en este estado.
                </span>
              )}
            </div>
          </section>

          <section style={cardStyle}>
            <h2 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600 }}>Ficha</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              <Field label="Cliente" value={clientId ? clientName ?? String(clientId) : '—'} />
              <Field label="Origen" value={ORIGIN_LABELS[ticket.origin]} />
              <Field label="Tipo" value={ticket.requestType ? REQUEST_TYPE_LABELS[ticket.requestType] : '—'} />
              <Field label="Categoría" value={ticket.serviceCategory ?? '—'} />
              <Field
                label="Asignado"
                value={ticket.assigneeUserId ? usersById.get(ticket.assigneeUserId) ?? String(ticket.assigneeUserId) : '—'}
              />
              <Field label="Nivel" value={ticket.escalationLevel ?? '—'} />
              <Field label="1ª respuesta" value={fmt(ticket.firstResponseAt)} />
              <Field label="Resuelto" value={fmt(ticket.resolvedAt)} />
              <Field label="Cerrado" value={fmt(ticket.closedAt)} />
              {ticket.jiraIssueKey && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: '#6d7577' }}>Jira</span>
                  <a
                    href={ticket.jiraIssueUrl ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'oklch(0.5 0.11 205)', textAlign: 'right' }}
                  >
                    {ticket.jiraIssueKey}
                  </a>
                </div>
              )}
            </div>
          </section>

          <TicketSlaClock ticket={ticket} />
        </div>
      </div>

      <ResolveDialog
        open={resolveOpen}
        onCancel={() => setResolveOpen(false)}
        onConfirm={(v) => {
          setResolveOpen(false);
          act(() =>
            ticketsApi.transition(id, {
              toStatus: 'RESUELTO',
              resolutionMd: v.resolutionMd,
              rootCause: v.rootCause,
              correctiveAction: v.correctiveAction,
            }),
          );
        }}
      />

      <AssignDialog
        open={assignOpen}
        ticketId={id}
        serviceCategory={ticket.serviceCategory}
        onCancel={() => setAssignOpen(false)}
        onConfirm={(v) => {
          setAssignOpen(false);
          act(() => ticketsApi.assign(id, v));
        }}
      />

      <OverridePriorityDialog
        open={priorityOpen}
        currentImpact={ticket.impact}
        currentUrgency={ticket.urgency}
        currentPriority={ticket.priority}
        onCancel={() => setPriorityOpen(false)}
        onConfirm={(v) => {
          setPriorityOpen(false);
          act(() => ticketsApi.overridePriority(id, v));
        }}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: '#6d7577' }}>{label}</span>
      <span style={{ color: '#3a4041', textAlign: 'right' }}>{value}</span>
    </div>
  );
}
