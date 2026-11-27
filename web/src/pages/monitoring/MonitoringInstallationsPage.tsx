import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthContext';
import { canManageLogInstallations } from '../../auth/permissions';
import { clientsApi } from '../../api/clients.api';
import {
  CreateInstallationBody,
  InstallationView,
  IssuedKey,
  KeyStatus,
  LOG_LEVELS,
  LogLevel,
  monitoringApi,
} from '../../api/monitoring.api';
import { clientSystemsApi, systemsApi } from '../../api/tickets.api';
import type { Client, ClientSystem, System } from '../../api/types';
import { askConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../ui/Toast';
import { ClientTag } from '../work-items/client-colors';
import AppenderManualDialog from './AppenderManualDialog';
import InstallationKeyDialog from './InstallationKeyDialog';
import { fmtDateTime } from './monitoring-ui';

type ApiError = { response?: { data?: { message?: string } } };
const apiMessage = (e: unknown, fallback: string) => (e as ApiError).response?.data?.message ?? fallback;

const inputStyle: React.CSSProperties = {
  fontSize: 13, padding: '8px 10px', border: '1px solid var(--k-border)', borderRadius: 6,
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 5, display: 'block' };
const btn: React.CSSProperties = { fontSize: 12, padding: '6px 10px', borderRadius: 6, background: '#fff', border: '1px solid var(--k-border-strong)', cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: 'var(--k-primary)', color: '#fff', border: 'none', cursor: 'pointer' };

const KEY_STYLES: Record<KeyStatus, { bg: string; fg: string; label: string }> = {
  ACTIVA: { bg: '#e6f4ea', fg: '#1e7a3c', label: 'Activa' },
  REVOCADA: { bg: '#fdecea', fg: '#b3261e', label: 'Revocada' },
  SIN_CLAVE: { bg: 'var(--k-surface-2)', fg: 'var(--k-muted)', label: 'Sin clave' },
};

/** La URL que se pega en log4net.config: sale del origen actual para valer en cualquier entorno. */
const ingestUrl = () => `${window.location.origin}/api/v1/ingest/logs`;

export default function MonitoringInstallationsPage() {
  const { user } = useAuth();
  if (!canManageLogInstallations(user)) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Instalaciones de monitoreo</h1>
        <p className="mt-2 text-sm text-slate-600">Solo un administrador puede gestionar las instalaciones y sus claves.</p>
      </div>
    );
  }
  return <InstallationsAdmin />;
}

function InstallationsAdmin() {
  const queryClient = useQueryClient();
  // La clave en claro se guarda solo aquí (estado de React), jamás en la caché de react-query.
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [creating, setCreating] = useState(false);
  const [showManual, setShowManual] = useState(false);
  /** '' = todas; 'c:<id>' = un cliente; 'interna' = las internas de Kubo. */
  const [clientFilter, setClientFilter] = useState('');
  const [downloading, setDownloading] = useState(false);
  // Filas con una emisión de clave en curso. Sin esto, un doble clic emite dos
  // claves y el diálogo puede quedarse con la primera, que el servidor ya
  // invalidó al emitir la segunda. El ref es el candado síncrono (el estado
  // tarda un render en deshabilitar el botón); el estado es lo que se ve.
  const keyInFlight = useRef(new Set<number>());
  const [busyKeyIds, setBusyKeyIds] = useState<ReadonlySet<number>>(new Set());
  const setKeyBusy = (id: number, busy: boolean) => {
    if (busy) keyInFlight.current.add(id);
    else keyInFlight.current.delete(id);
    setBusyKeyIds(new Set(keyInFlight.current));
  };

  const installations = useQuery({ queryKey: ['monitoring', 'installations'], queryFn: monitoringApi.listInstallations });
  const disk = useQuery({ queryKey: ['monitoring', 'disk'], queryFn: monitoringApi.disk, refetchInterval: 5 * 60_000 });
  const manual = useQuery({ queryKey: ['monitoring', 'manual'], queryFn: monitoringApi.manual, staleTime: 10 * 60_000 });

  const groupKey = (i: InstallationView) => (i.kind === 'CLIENTE' && i.clientId !== null ? `c:${i.clientId}` : 'interna');
  const groupName = (i: InstallationView) => (i.kind === 'CLIENTE' ? i.clientName ?? 'Cliente' : 'Interno (Kubo)');
  const clientOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of installations.data ?? []) m.set(groupKey(i), groupName(i));
    return [...m.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'es'));
  }, [installations.data]);
  // Agrupadas por cliente (las internas al final), y dentro por sistema.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; name: string; clientId: number | null; rows: InstallationView[] }>();
    for (const i of installations.data ?? []) {
      const key = groupKey(i);
      if (clientFilter && key !== clientFilter) continue;
      const g = m.get(key) ?? { key, name: groupName(i), clientId: key === 'interna' ? null : i.clientId, rows: [] };
      g.rows.push(i);
      m.set(key, g);
    }
    return [...m.values()]
      .sort((a, b) => (a.clientId === null ? 1 : 0) - (b.clientId === null ? 1 : 0) || a.name.localeCompare(b.name, 'es'))
      .map((g) => ({ ...g, rows: g.rows.sort((a, b) => (a.systemName ?? a.displayName).localeCompare(b.systemName ?? b.displayName, 'es')) }));
  }, [installations.data, clientFilter]);

  const reload = () => queryClient.invalidateQueries({ queryKey: ['monitoring', 'installations'] });

  const changeLevel = async (i: InstallationView, minLevel: LogLevel) => {
    try {
      await monitoringApi.updateInstallation(i.id, { minLevel });
      toast.success('Nivel mínimo actualizado.');
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo cambiar el nivel mínimo.'));
    }
    reload();
  };

  const regenerate = async (i: InstallationView) => {
    if (keyInFlight.current.has(i.id)) return;
    // Ocupada desde antes de confirmar: un doble clic tampoco abre dos confirmaciones.
    setKeyBusy(i.id, true);
    try {
      if (i.keyStatus === 'ACTIVA') {
        const ok = await askConfirm({
          title: 'Regenerar la clave',
          message: `La clave actual de «${i.displayName}» dejará de valer y los servidores que la usen tendrán que actualizarla. ¿Continuar?`,
          tone: 'warning',
          confirmText: 'Regenerar',
        });
        if (!ok) return;
      }
      try {
        setIssued(await monitoringApi.regenerateKey(i.id));
      } catch (e) {
        toast.error(apiMessage(e, 'No se pudo generar la clave.'));
      }
      reload();
    } finally {
      setKeyBusy(i.id, false);
    }
  };

  const revoke = async (i: InstallationView) => {
    const ok = await askConfirm({
      title: 'Revocar la clave',
      message: `«${i.displayName}» dejará de poder enviar logs de inmediato. Podrás generar una clave nueva cuando quieras.`,
      tone: 'danger',
      confirmText: 'Revocar',
    });
    if (!ok) return;
    try {
      await monitoringApi.revokeKey(i.id);
      toast.success('Clave revocada.');
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo revocar la clave.'));
    }
    reload();
  };

  const download = async () => {
    setDownloading(true);
    try {
      await monitoringApi.downloadPackage();
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo descargar el appender.'));
    } finally {
      setDownloading(false);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(ingestUrl());
      toast.success('URL copiada.');
    } catch {
      toast.error('No se pudo copiar la URL.');
    }
  };

  const d = disk.data;
  const version = manual.data?.version;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="text-xl font-semibold text-slate-900">Instalaciones de monitoreo</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={btn} onClick={() => setShowManual(true)}>Manual de implementación</button>
          <button type="button" style={btn} onClick={download} disabled={downloading || !version}>
            {downloading ? 'Descargando…' : `Descargar appender${version ? ` v${version}` : ''}`}
          </button>
          <button type="button" style={btnPrimary} onClick={() => setCreating(true)}>Nueva instalación</button>
        </div>
      </div>

      {d?.alert && (
        <div role="alert" style={{ fontSize: 13, lineHeight: 1.5, borderRadius: 6, padding: '10px 12px', color: '#a35c00', background: '#fff4e0', border: '1px solid #f0d9a8' }}>
          <b>El disco de logs está al {d.usedPct !== null ? `${Math.round(d.usedPct)} %` : 'límite'}</b> (umbral {d.threshold} %).
          Para liberar espacio, acorta la retención de Loki bajando <code>LOKI_RETENTION</code> en el entorno (por omisión <code>720h</code>, 30 días; por ejemplo <code>336h</code> son 14) y reinicia Loki.
        </div>
      )}

      <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>URL de ingesta (para log4net.config):</span>
        <code style={{ background: '#f3f5f5', padding: '4px 8px', borderRadius: 5 }}>{ingestUrl()}</code>
        <button type="button" style={btn} onClick={copyUrl}>Copiar</button>
      </div>

      {clientOptions.length > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            aria-label="Filtrar por cliente"
            style={{ ...inputStyle, width: 'auto', minWidth: 220 }}
          >
            <option value="">Todos los clientes</option>
            {clientOptions.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
          {clientFilter && <button type="button" style={btn} onClick={() => setClientFilter('')}>Quitar filtro</button>}
        </div>
      )}

      {installations.isLoading && <div style={{ fontSize: 13, color: 'var(--k-muted)' }}>Cargando…</div>}
      {installations.error && <div role="alert" style={{ fontSize: 13, color: '#b3261e' }}>No se pudieron cargar las instalaciones.</div>}

      {installations.data && (
        installations.data.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--k-muted)' }}>Aún no hay instalaciones. Crea la primera con «Nueva instalación».</div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid #e6e9ea', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', background: '#f7f8f8', color: 'var(--k-muted)', fontSize: 12 }}>
                  {['Instalación', 'Último envío', 'Aplicativos y servidores', 'Clave', 'Nivel mínimo', ''].map((h, n) => (
                    <th key={n} style={{ padding: '8px 10px', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => [
                  <tr key={`h-${g.key}`} style={{ borderTop: '1px solid var(--k-border)', background: 'var(--k-surface-2)' }}>
                    <td colSpan={6} style={{ padding: '8px 10px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {g.clientId !== null ? <ClientTag clientId={g.clientId} name={g.name} /> : <strong style={{ fontSize: 12 }}>{g.name}</strong>}
                        <span style={{ fontSize: 12, color: 'var(--k-muted)' }}>
                          {g.rows.length} {g.rows.length === 1 ? 'instalación' : 'instalaciones'}
                        </span>
                      </span>
                    </td>
                  </tr>,
                  ...g.rows.map((i) => {
                  const ks = KEY_STYLES[i.keyStatus];
                  return (
                    <tr key={i.id} style={{ borderTop: '1px solid var(--k-surface-2)', verticalAlign: 'top' }}>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ fontWeight: 600 }}>{i.kind === 'CLIENTE' ? i.systemName ?? i.displayName : i.displayName}</div>
                        {i.kind !== 'CLIENTE' && i.systemName && (
                          <div style={{ fontSize: 12, color: 'var(--k-muted)' }}>{i.systemName}</div>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{fmtDateTime(i.lastSeenAt)}</td>
                      <td style={{ padding: '8px 10px' }}>
                        {i.sources.length === 0 ? '—' : i.sources.map((s) => (
                          <div key={`${s.aplicativo}|${s.servidor}`} style={{ fontSize: 12 }}>
                            {s.aplicativo} · {s.servidor}
                            {s.appenderVersion && <span style={{ color: 'var(--k-muted)' }}> (v{s.appenderVersion})</span>}
                          </div>
                        ))}
                      </td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                        <span style={{ background: ks.bg, color: ks.fg, borderRadius: 4, padding: '2px 7px', fontSize: 12, fontWeight: 600 }}>{ks.label}</span>
                        {i.keyPrefix && <code style={{ marginLeft: 6, fontSize: 12 }}>{i.keyPrefix}…</code>}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <select
                          aria-label={`Nivel mínimo de ${i.displayName}`}
                          value={i.minLevel}
                          onChange={(e) => changeLevel(i, e.target.value as LogLevel)}
                          style={{ ...inputStyle, width: 'auto', padding: '5px 8px' }}
                        >
                          {LOG_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            style={{ ...btn, ...(busyKeyIds.has(i.id) ? { opacity: 0.6, cursor: 'wait' } : null) }}
                            onClick={() => regenerate(i)}
                            disabled={busyKeyIds.has(i.id)}
                            aria-busy={busyKeyIds.has(i.id)}
                          >
                            {busyKeyIds.has(i.id) ? 'Generando…' : i.keyStatus === 'ACTIVA' ? 'Regenerar' : 'Generar clave'}
                          </button>
                          {i.keyStatus === 'ACTIVA' && (
                            <button type="button" style={{ ...btn, color: '#b3261e' }} onClick={() => revoke(i)}>Revocar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                  }),
                ])}
              </tbody>
            </table>
          </div>
        )
      )}

      <AppenderManualDialog
        open={showManual}
        manual={manual.data}
        loading={manual.isLoading}
        failed={!!manual.error}
        onClose={() => setShowManual(false)}
      />

      <NewInstallationDialog
        open={creating}
        onCancel={() => setCreating(false)}
        onCreated={(k) => { setCreating(false); setIssued(k); reload(); }}
      />
      <InstallationKeyDialog issued={issued} onClose={() => setIssued(null)} />
    </div>
  );
}

function NewInstallationDialog({ open, onCancel, onCreated }: {
  open: boolean;
  onCancel: () => void;
  onCreated: (k: IssuedKey) => void;
}) {
  const [kind, setKind] = useState<'CLIENTE' | 'INTERNA'>('CLIENTE');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<number | ''>('');
  const [assignments, setAssignments] = useState<ClientSystem[] | null>(null);
  const [clientSystemId, setClientSystemId] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [systems, setSystems] = useState<System[]>([]);
  const [systemId, setSystemId] = useState<number | ''>('');
  const [minLevel, setMinLevel] = useState<LogLevel>('INFO');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind('CLIENTE'); setClientId(''); setAssignments(null); setClientSystemId('');
    setName(''); setSystemId(''); setMinLevel('INFO'); setError(null); setBusy(false);
    let cancelled = false;
    clientsApi.list({ status: 'CLIENT' }).then((l) => { if (!cancelled) setClients(l); }).catch(() => { if (!cancelled) setClients([]); });
    systemsApi.list().then((l) => { if (!cancelled) setSystems(l.filter((s) => s.isActive === 1)); }).catch(() => { if (!cancelled) setSystems([]); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    setAssignments(null);
    setClientSystemId('');
    if (!open || clientId === '') return;
    let cancelled = false;
    clientSystemsApi
      .list(clientId)
      // Solo las asignaciones con producto del catálogo pueden tener instalación (el backend rechaza el resto).
      .then((l) => { if (!cancelled) setAssignments(l.filter((a) => a.isActive === 1 && a.systemId != null)); })
      .catch(() => { if (!cancelled) setAssignments([]); });
    return () => { cancelled = true; };
  }, [open, clientId]);

  if (!open) return null;

  const canSubmit = !busy && (kind === 'CLIENTE' ? clientSystemId !== '' : name.trim() !== '');

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const body: CreateInstallationBody = kind === 'CLIENTE'
      ? { kind, clientSystemId: clientSystemId as number, minLevel }
      : { kind, name: name.trim(), ...(systemId !== '' ? { systemId } : {}), minLevel };
    try {
      onCreated(await monitoringApi.createInstallation(body));
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      setError(status === 409
        ? 'Esa asignación ya tiene una instalación: regenera su clave desde la lista.'
        : apiMessage(e, 'No se pudo crear la instalación.'));
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-installation-title"
      onClick={() => { if (!busy) onCancel(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 22, width: 480, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 id="new-installation-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Nueva instalación</h2>

        {error && <div role="alert" style={{ fontSize: 12, borderRadius: 6, padding: '8px 10px', color: '#b3261e', background: '#fdecea' }}>{error}</div>}

        <label>
          <span style={labelStyle}>Tipo</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'CLIENTE' | 'INTERNA')} style={inputStyle}>
            <option value="CLIENTE">De un cliente</option>
            <option value="INTERNA">Interna (sistema propio)</option>
          </select>
        </label>

        {kind === 'CLIENTE' ? (
          <>
            <label>
              <span style={labelStyle}>Cliente</span>
              <select value={clientId} onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : '')} style={inputStyle}>
                <option value="">Elige un cliente…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}
              </select>
            </label>
            {clientId !== '' && (
              assignments !== null && assignments.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--k-muted)', lineHeight: 1.4 }}>
                  Este cliente no tiene sistemas del catálogo asignados y activos. Asígnalos primero en la ficha del cliente.
                </span>
              ) : (
                <label>
                  <span style={labelStyle}>Sistema</span>
                  <select value={clientSystemId} onChange={(e) => setClientSystemId(e.target.value ? Number(e.target.value) : '')} style={inputStyle}>
                    <option value="">{assignments === null ? 'Cargando…' : 'Elige un sistema…'}</option>
                    {/* El valor es el de la asignación (`client_systems.id`). */}
                    {(assignments ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
              )
            )}
          </>
        ) : (
          <>
            <label>
              <span style={labelStyle}>Nombre *</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} style={inputStyle} />
            </label>
            <label>
              <span style={labelStyle}>Sistema (opcional)</span>
              <select value={systemId} onChange={(e) => setSystemId(e.target.value ? Number(e.target.value) : '')} style={inputStyle}>
                <option value="">(ninguno)</option>
                {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </>
        )}

        <label>
          <span style={labelStyle}>Nivel mínimo</span>
          <select value={minLevel} onChange={(e) => setMinLevel(e.target.value as LogLevel)} style={inputStyle}>
            {LOG_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={{ ...btn, padding: '9px 14px', fontSize: 13 }} onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="button" style={{ ...btnPrimary, background: canSubmit ? 'var(--k-ink)' : 'var(--k-disabled)', cursor: canSubmit ? 'pointer' : 'not-allowed' }} onClick={submit} disabled={!canSubmit}>
            {busy ? 'Creando…' : 'Crear y ver clave'}
          </button>
        </div>
      </div>
    </div>
  );
}
