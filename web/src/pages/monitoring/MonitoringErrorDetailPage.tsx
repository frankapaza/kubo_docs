import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { monitoringApi } from '../../api/monitoring.api';
import { useRealtime } from '../../lib/realtime';
import { askConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../ui/Toast';
import CreateTicketFromErrorDialog from './CreateTicketFromErrorDialog';
import ErrorOccurrencesChart from './ErrorOccurrencesChart';
import { ERROR_STATUS_LABELS, ERROR_STATUS_STYLES, fmtDateTime } from './monitoring-ui';

const FIVE_MIN_MS = 5 * 60 * 1000;

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e5e6', borderRadius: 10, padding: '16px 18px' };
const h2: React.CSSProperties = { margin: '0 0 10px', fontSize: 13, fontWeight: 600 };
const btn = (primary: boolean): React.CSSProperties => ({
  fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, cursor: 'pointer', textDecoration: 'none',
  background: primary ? '#15191a' : '#fff', color: primary ? '#fff' : '#15191a',
  border: primary ? 'none' : '1px solid #d8dcdd',
});

const msgOf = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6d7577', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#15191a', overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  );
}

/** Nota opcional al marcar como resuelto; el `ConfirmDialog` genérico no tiene campo de texto. */
function ResolveNoteDialog({ open, busy, onCancel, onConfirm }: {
  open: boolean; busy: boolean; onCancel: () => void; onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  useEffect(() => { if (open) setNote(''); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);
  if (!open) return null;
  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="resolve-error-title"
      onClick={() => { if (!busy) onCancel(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 22, width: 460, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 id="resolve-error-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Marcar el error como resuelto</h2>
        <span style={{ fontSize: 12, color: '#6d7577', lineHeight: 1.5 }}>
          Si vuelve a ocurrir, el error se reabre solo y avisa.
        </span>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Nota (opcional)</span>
          <textarea
            value={note} rows={3} maxLength={1000} onChange={(e) => setNote(e.target.value)}
            style={{ fontSize: 13, padding: 9, border: '1px solid #dfe3e4', borderRadius: 6, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} disabled={busy} style={btn(false)}>Cancelar</button>
          <button type="button" onClick={() => onConfirm(note.trim())} disabled={busy} style={btn(true)}>
            {busy ? 'Guardando…' : 'Resuelto'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MonitoringErrorDetailPage() {
  const { errorId } = useParams();
  const id = Number(errorId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ticketOpen, setTicketOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: group, isLoading, error, refetch } = useQuery({
    queryKey: ['monitoring-error', id],
    queryFn: () => monitoringApi.getError(id),
    enabled: Number.isFinite(id),
  });

  const reload = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['monitoring-errors'] });
    return refetch();
  }, [queryClient, refetch]);

  useRealtime('errors:changed', useCallback(() => { void reload(); }, [reload]));

  if (isLoading) return <div style={{ padding: 26, fontSize: 13, color: '#6d7577' }}>Cargando…</div>;
  if (error || !group) {
    return (
      <div style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div role="alert" style={{ fontSize: 13, color: 'oklch(0.5 0.16 25)' }}>
          {msgOf(error, 'No se pudo cargar el error.')}
        </div>
        <Link to="/monitoreo/errores" style={{ fontSize: 13, color: '#0b6e75' }}>Volver a Errores</Link>
      </div>
    );
  }

  const st = ERROR_STATUS_STYLES[group.status];
  const last = group.occurrences.reduce<(typeof group.occurrences)[number] | null>(
    (a, o) => (!a || new Date(o.occurredAt) > new Date(a.occurredAt) ? o : a),
    null,
  );
  const lastMs = new Date(group.lastSeenAt).getTime();
  const logsHref =
    `/monitoreo/logs?instalacionId=${group.installationId}` +
    `&desde=${encodeURIComponent(new Date(lastMs - FIVE_MIN_MS).toISOString())}` +
    `&hasta=${encodeURIComponent(new Date(lastMs + FIVE_MIN_MS).toISOString())}`;

  const resolve = async (note: string) => {
    setBusy(true);
    try {
      await monitoringApi.resolveError(group.id, note || undefined);
      toast.success('Error marcado como resuelto.');
      setResolveOpen(false);
      await reload();
    } catch (e) {
      toast.error(msgOf(e, 'No se pudo marcar como resuelto.'));
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    const ok = await askConfirm({
      title: 'Reabrir error',
      message: '¿Reabrir este error? Volverá a aparecer como nuevo o con ticket.',
      confirmText: 'Reabrir',
      tone: 'warning',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await monitoringApi.reopenError(group.id);
      toast.success('Error reabierto.');
      await reload();
    } catch (e) {
      toast.error(msgOf(e, 'No se pudo reabrir el error.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1100 }}>
      <Link to="/monitoreo/errores" style={{ fontSize: 12, color: '#6d7577', textDecoration: 'none' }}>← Errores</Link>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 400px' }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, overflowWrap: 'anywhere' }}>{group.title}</h1>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 10, background: st.bg, color: st.fg }}>
              {ERROR_STATUS_LABELS[group.status]}
            </span>
            {group.reopenedAt && (
              <span style={{ fontSize: 12, color: '#a35c00' }}>
                Reabierto el {fmtDateTime(group.reopenedAt)}{group.reopenReason ? `: ${group.reopenReason}` : ''}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {group.status !== 'CON_TICKET' && (
            <button type="button" disabled={busy} onClick={() => setTicketOpen(true)} style={btn(true)}>Crear ticket</button>
          )}
          {group.status !== 'RESUELTO' && (
            <button type="button" disabled={busy} onClick={() => setResolveOpen(true)} style={btn(false)}>Resuelto</button>
          )}
          {group.status === 'RESUELTO' && (
            <button type="button" disabled={busy} onClick={reopen} style={btn(false)}>Reabrir</button>
          )}
          <Link to={logsHref} style={btn(false)}>Ver logs alrededor</Link>
        </div>
      </div>

      <section style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        <Field label="Cliente">{group.clientName ?? 'Interno'}</Field>
        <Field label="Sistema">{group.systemName ?? '—'}</Field>
        <Field label="Aplicativo">{group.aplicativo}</Field>
        <Field label="Logger">{group.logger}</Field>
        <Field label="Excepción">{group.exceptionType ?? '—'}</Field>
        <Field label="Servidores">{group.servers.length ? group.servers.join(', ') : '—'}</Field>
        <Field label="Primera vez">{fmtDateTime(group.firstSeenAt)}</Field>
        <Field label="Última vez">{fmtDateTime(group.lastSeenAt)}</Field>
        <Field label="Ocurrencias">{group.occurrencesTotal.toLocaleString('es-PE')}</Field>
        <Field label="Ticket">
          {group.ticket ? (
            <Link to={`/tickets/${group.ticket.id}`} style={{ fontWeight: 600, color: '#0b6e75', textDecoration: 'none' }}>
              {group.ticket.code}
            </Link>
          ) : '—'}
        </Field>
        {group.status === 'RESUELTO' && (
          <Field label="Resuelto">
            {fmtDateTime(group.resolvedAt)}{group.resolvedByName ? ` por ${group.resolvedByName}` : ''}
            {group.resolutionNote ? ` — ${group.resolutionNote}` : ''}
          </Field>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Ocurrencias por día (últimos 30 días)</h2>
        <ErrorOccurrencesChart daily={group.daily} />
      </section>

      <section style={card}>
        <h2 style={h2}>Traza de la última ocurrencia</h2>
        {last?.exception ? (
          <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.5, background: '#f6f7f7', borderRadius: 6, padding: 12, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre' }}>
            {last.exception}
          </pre>
        ) : (
          <span style={{ fontSize: 12, color: '#6d7577' }}>La última ocurrencia no trae traza.</span>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Ocurrencias recientes ({group.occurrences.length})</h2>
        {group.occurrences.length === 0 && <span style={{ fontSize: 12, color: '#6d7577' }}>Sin muestras guardadas.</span>}
        {group.occurrences.map((o) => (
          <details key={o.id} style={{ borderTop: '1px solid #f1f3f3', padding: '8px 0' }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, display: 'flex', gap: 10, listStyle: 'revert' }}>
              <span style={{ color: '#6d7577', whiteSpace: 'nowrap' }}>{fmtDateTime(o.occurredAt)}</span>
              <span style={{ color: '#6d7577' }}>{o.servidor}</span>
              <span style={{ overflowWrap: 'anywhere' }}>{o.message}</span>
            </summary>
            <div style={{ marginTop: 8, display: 'grid', gap: 8, fontSize: 12 }}>
              <div><b>Logger:</b> {o.logger}{o.hilo ? <> · <b>Hilo:</b> {o.hilo}</> : null}</div>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{o.message}</div>
              {o.exception && (
                <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.5, background: '#f6f7f7', borderRadius: 6, padding: 10, maxHeight: 240, overflow: 'auto' }}>
                  {o.exception}
                </pre>
              )}
              {o.properties && Object.keys(o.properties).length > 0 && (
                <table style={{ fontSize: 11, borderCollapse: 'collapse' }}>
                  <tbody>
                    {Object.entries(o.properties).map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ padding: '2px 10px 2px 0', fontWeight: 600, color: '#6d7577', verticalAlign: 'top' }}>{k}</td>
                        <td style={{ padding: '2px 0', overflowWrap: 'anywhere' }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </details>
        ))}
      </section>

      <CreateTicketFromErrorDialog
        open={ticketOpen}
        group={group}
        onCancel={() => setTicketOpen(false)}
        onCreated={(r) => {
          setTicketOpen(false);
          toast.success(`Ticket ${r.ticket.code} creado.`);
          queryClient.invalidateQueries({ queryKey: ['monitoring-errors'] });
          navigate(`/tickets/${r.ticket.id}`);
        }}
        onStale={() => {
          setTicketOpen(false);
          void reload();
        }}
      />
      <ResolveNoteDialog open={resolveOpen} busy={busy} onCancel={() => setResolveOpen(false)} onConfirm={resolve} />
    </div>
  );
}
