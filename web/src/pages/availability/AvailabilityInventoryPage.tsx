import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  availabilityApi, Criticality, EntityStatus, MonitorServer, MonitorService, Protocol, ServerBody, ServiceBody,
} from '../../api/availability.api';
import { clientsApi } from '../../api/clients.api';
import { clientSystemsApi } from '../../api/tickets.api';
import type { ClientSystem } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { askConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../ui/Toast';
import {
  apiMessage, btn, btnPrimary, CRITICALITY_LABELS, inputStyle, labelStyle, PROTOCOL_OPTIONS, tableWrap, td, th,
} from './availability-ui';

type Panel =
  | { kind: 'server'; server: MonitorServer | null }
  | { kind: 'service'; server: MonitorServer; service: MonitorService | null };

const STATUS_TEXT: Record<EntityStatus, string> = { ACTIVE: 'Activo', PAUSED: 'Pausado', ARCHIVED: 'Archivado' };

export default function AvailabilityInventoryPage() {
  const { user } = useAuth();
  // Alta, edición, pausa/archivo, prueba y tokens son solo de ADMIN en el backend.
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [clientFilter, setClientFilter] = useState<number | ''>('');
  const [panel, setPanel] = useState<Panel | null>(null);

  const clients = useQuery({ queryKey: ['availability', 'clients'], queryFn: () => clientsApi.list(), staleTime: 5 * 60_000 });
  const servers = useQuery({ queryKey: ['availability', 'servers'], queryFn: availabilityApi.listServers });
  const services = useQuery({ queryKey: ['availability', 'services'], queryFn: () => availabilityApi.listServices() });

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ['availability', 'servers'] });
    queryClient.invalidateQueries({ queryKey: ['availability', 'services'] });
    queryClient.invalidateQueries({ queryKey: ['availability', 'state'] });
  };

  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.razonSocial])), [clients.data]);
  const visible = (servers.data ?? []).filter((s) => clientFilter === '' || s.clientId === clientFilter);
  const groups = useMemo(() => {
    const m = new Map<number, MonitorServer[]>();
    for (const s of visible) m.set(s.clientId, [...(m.get(s.clientId) ?? []), s]);
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers.data, clientFilter]);

  const setServerStatus = async (s: MonitorServer, status: EntityStatus) => {
    if (status !== 'ACTIVE') {
      const archive = status === 'ARCHIVED';
      const ok = await askConfirm({
        title: archive ? 'Archivar servidor' : 'Pausar servidor',
        message: `${archive ? 'Archivar' : 'Pausar'} «${s.name}» deja de comprobar todos sus servicios y CIERRA sus incidentes abiertos. ¿Continuar?`,
        tone: 'danger',
        confirmText: archive ? 'Archivar' : 'Pausar',
      });
      if (!ok) return;
    }
    try {
      await availabilityApi.updateServer(s.id, { status });
      toast.success('Servidor actualizado.');
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo cambiar el estado del servidor.'));
    }
    reload();
  };

  const setServiceStatus = async (s: MonitorService, status: EntityStatus) => {
    if (status !== 'ACTIVE') {
      const archive = status === 'ARCHIVED';
      const ok = await askConfirm({
        title: archive ? 'Archivar servicio' : 'Pausar servicio',
        message: `${archive ? 'Archivar' : 'Pausar'} «${s.name}» deja de comprobarlo y CIERRA sus incidentes abiertos. ¿Continuar?`,
        tone: 'danger',
        confirmText: archive ? 'Archivar' : 'Pausar',
      });
      if (!ok) return;
    }
    try {
      await availabilityApi.updateService(s.id, { status });
      toast.success('Servicio actualizado.');
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo cambiar el estado del servicio.'));
    }
    reload();
  };

  const test = async (s: MonitorService) => {
    try {
      const r = await availabilityApi.testService(s.id);
      if (r.ok) toast.success(`«${s.name}» responde (${r.durationMs} ms).`);
      else toast.error(`«${s.name}» falla: ${r.errorCode ?? 'sin respuesta'}${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ''}.`);
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo probar la configuración.'));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="text-xl font-semibold text-slate-900">Inventario de monitoreo</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            aria-label="Cliente"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value ? Number(e.target.value) : '')}
            style={{ ...inputStyle, width: 'auto' }}
          >
            <option value="">Todos los clientes</option>
            {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}
          </select>
          {isAdmin && <button type="button" style={btnPrimary} onClick={() => setPanel({ kind: 'server', server: null })}>Nuevo servidor</button>}
        </div>
      </div>

      {!isAdmin && (
        <div style={{ fontSize: 12, color: '#6d7577' }}>Solo un administrador puede modificar el inventario.</div>
      )}
      {(servers.isLoading || services.isLoading) && <div style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</div>}
      {(servers.error || services.error) && <div role="alert" style={{ fontSize: 13, color: '#b3261e' }}>No se pudo cargar el inventario.</div>}
      {servers.data && groups.length === 0 && (
        <div style={{ fontSize: 13, color: '#6d7577' }}>Aún no hay servidores{isAdmin ? '. Crea el primero con «Nuevo servidor»' : ''}.</div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groups.map(([cid, list]) => (
            <section key={cid}>
              <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>{clientName.get(cid) ?? `Cliente #${cid}`}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {list.map((s) => {
                  const svcs = (services.data ?? []).filter((x) => x.serverId === s.id);
                  return (
                    <div key={s.id} style={{ border: '1px solid #e6e9ea', borderRadius: 8, opacity: s.status === 'ARCHIVED' ? 0.6 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', flexWrap: 'wrap', background: '#f7f8f8', borderRadius: '8px 8px 0 0' }}>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name} <span style={{ fontWeight: 400, color: '#6d7577' }}>· {STATUS_TEXT[s.status]}</span></div>
                          <div style={{ fontSize: 12, color: '#6d7577' }}>{s.host}{s.role ? ` · ${s.role}` : ''}{s.region ? ` · ${s.region}` : ''}</div>
                        </div>
                        {isAdmin && s.status !== 'ARCHIVED' && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button type="button" style={btn} onClick={() => setPanel({ kind: 'service', server: s, service: null })}>Nuevo servicio</button>
                            <button type="button" style={btn} onClick={() => setPanel({ kind: 'server', server: s })}>Editar</button>
                            {s.status === 'ACTIVE'
                              ? <button type="button" style={btn} onClick={() => setServerStatus(s, 'PAUSED')}>Pausar</button>
                              : <button type="button" style={btn} onClick={() => setServerStatus(s, 'ACTIVE')}>Reanudar</button>}
                            <button type="button" style={{ ...btn, color: '#b3261e' }} onClick={() => setServerStatus(s, 'ARCHIVED')}>Archivar</button>
                          </div>
                        )}
                      </div>
                      {svcs.length > 0 && (
                        <div style={tableWrap}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr style={{ textAlign: 'left', color: '#6d7577', fontSize: 12 }}>
                                {['Servicio', 'Destino', 'Umbral', 'Criticidad', 'Estado', ''].map((h, n) => <th key={n} style={th}>{h}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {svcs.map((v) => (
                                <tr key={v.id} style={{ borderTop: '1px solid #eef0f1', opacity: v.status === 'ARCHIVED' ? 0.6 : 1 }}>
                                  <td style={{ ...td, fontWeight: 600 }}>{v.name}</td>
                                  <td style={td}>{v.protocol} {v.target}{v.port ? `:${v.port}` : ''}</td>
                                  <td style={td}>{v.latencyThresholdMs} ms</td>
                                  <td style={td}>{CRITICALITY_LABELS[v.criticality]}</td>
                                  <td style={td}>{STATUS_TEXT[v.status]}</td>
                                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                    {isAdmin && v.status !== 'ARCHIVED' && (
                                      <div style={{ display: 'flex', gap: 6 }}>
                                        <button type="button" style={btn} onClick={() => setPanel({ kind: 'service', server: s, service: v })}>Editar</button>
                                        <button type="button" style={btn} onClick={() => test(v)}>Probar configuración</button>
                                        {v.status === 'ACTIVE'
                                          ? <button type="button" style={btn} onClick={() => setServiceStatus(v, 'PAUSED')}>Pausar</button>
                                          : <button type="button" style={btn} onClick={() => setServiceStatus(v, 'ACTIVE')}>Reanudar</button>}
                                        <button type="button" style={{ ...btn, color: '#b3261e' }} onClick={() => setServiceStatus(v, 'ARCHIVED')}>Archivar</button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {isAdmin && panel && (
          <aside style={{ width: 360, maxWidth: '100%', border: '1px solid #e6e9ea', borderRadius: 8, padding: 16, background: '#fff' }}>
            {panel.kind === 'server' ? (
              <ServerForm
                key={panel.server?.id ?? 'new'}
                server={panel.server}
                clients={(clients.data ?? []).map((c) => ({ id: c.id, name: c.razonSocial }))}
                onCancel={() => setPanel(null)}
                onSaved={() => { setPanel(null); reload(); }}
              />
            ) : (
              <ServiceForm
                key={panel.service?.id ?? `new-${panel.server.id}`}
                server={panel.server}
                clientLabel={clientName.get(panel.server.clientId) ?? `Cliente #${panel.server.clientId}`}
                service={panel.service}
                onCancel={() => setPanel(null)}
                onSaved={() => { setPanel(null); reload(); }}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function ServerForm({ server, clients, onCancel, onSaved }: {
  server: MonitorServer | null;
  clients: { id: number; name: string }[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState<number | ''>(server?.clientId ?? '');
  const [name, setName] = useState(server?.name ?? '');
  const [host, setHost] = useState(server?.host ?? '');
  const [role, setRole] = useState(server?.role ?? '');
  const [provider, setProvider] = useState(server?.provider ?? '');
  const [region, setRegion] = useState(server?.region ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !busy && name.trim() !== '' && host.trim() !== '' && (server !== null || clientId !== '');

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const fields: ServerBody = { name: name.trim(), host: host.trim(), role: role.trim(), provider: provider.trim(), region: region.trim() };
    // Cadenas vacías fuera: el backend las trataría como un valor.
    for (const k of ['role', 'provider', 'region'] as const) if (fields[k] === '') delete fields[k];
    try {
      if (server) await availabilityApi.updateServer(server.id, fields);
      else await availabilityApi.createServer({ ...fields, clientId: clientId as number });
      toast.success(server ? 'Servidor actualizado.' : 'Servidor creado.');
      onSaved();
    } catch (e) {
      setError(apiMessage(e, 'No se pudo guardar el servidor.'));
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{server ? 'Editar servidor' : 'Nuevo servidor'}</h2>
      {error && <div role="alert" style={{ fontSize: 12, borderRadius: 6, padding: '8px 10px', color: '#b3261e', background: '#fdecea' }}>{error}</div>}
      <label>
        <span style={labelStyle}>Cliente *</span>
        <select value={clientId} disabled={server !== null} onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : '')} style={inputStyle}>
          <option value="">Elige un cliente…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label><span style={labelStyle}>Nombre *</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} style={inputStyle} /></label>
      <label><span style={labelStyle}>Host (IP o nombre) *</span><input value={host} onChange={(e) => setHost(e.target.value)} maxLength={255} style={inputStyle} /></label>
      <label><span style={labelStyle}>Rol</span><input value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} style={inputStyle} /></label>
      <label><span style={labelStyle}>Proveedor</span><input value={provider} onChange={(e) => setProvider(e.target.value)} maxLength={80} style={inputStyle} /></label>
      <label><span style={labelStyle}>Región</span><input value={region} onChange={(e) => setRegion(e.target.value)} maxLength={80} style={inputStyle} /></label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={btn} onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="button" style={btnPrimary} onClick={submit} disabled={!canSubmit}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </div>
  );
}

function ServiceForm({ server, clientLabel, service, onCancel, onSaved }: {
  server: MonitorServer;
  clientLabel: string;
  service: MonitorService | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [systems, setSystems] = useState<ClientSystem[] | null>(null);
  const [systemId, setSystemId] = useState<number | ''>(service?.systemId ?? '');
  const [name, setName] = useState(service?.name ?? '');
  const [protocol, setProtocol] = useState<Protocol>(service?.protocol ?? 'TCP');
  const [target, setTarget] = useState(service?.target ?? '');
  const [port, setPort] = useState(service?.port ? String(service.port) : '');
  const [threshold, setThreshold] = useState(String(service?.latencyThresholdMs ?? 1500));
  const [criticality, setCriticality] = useState<Criticality>(service?.criticality ?? 'MEDIUM');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // El sistema es una asignación del cliente del servidor (`client_systems.id`).
    clientSystemsApi.list(server.clientId)
      .then((l) => { if (!cancelled) setSystems(l.filter((a) => a.isActive === 1 || a.id === service?.systemId)); })
      .catch(() => { if (!cancelled) setSystems([]); });
    return () => { cancelled = true; };
  }, [server.clientId, service?.systemId]);

  const portNum = port.trim() === '' ? null : Number(port);
  const thresholdNum = Number(threshold);
  const portOk = portNum === null ? protocol !== 'TCP' : Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
  const canSubmit = !busy && name.trim() !== '' && target.trim() !== '' && portOk && Number.isInteger(thresholdNum) && thresholdNum >= 1 && thresholdNum <= 600000;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const body: ServiceBody = {
      name: name.trim(), protocol, target: target.trim(), latencyThresholdMs: thresholdNum, criticality,
      ...(portNum !== null ? { port: portNum } : {}),
      ...(systemId !== '' ? { systemId } : {}),
    };
    try {
      if (service) await availabilityApi.updateService(service.id, body);
      else await availabilityApi.createService({ ...body, serverId: server.id });
      toast.success(service ? 'Servicio actualizado.' : 'Servicio creado.');
      onSaved();
    } catch (e) {
      setError(apiMessage(e, 'No se pudo guardar el servicio.'));
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{service ? 'Editar servicio' : 'Nuevo servicio'}</h2>
      {error && <div role="alert" style={{ fontSize: 12, borderRadius: 6, padding: '8px 10px', color: '#b3261e', background: '#fdecea' }}>{error}</div>}
      <label><span style={labelStyle}>Cliente</span><input value={`${clientLabel} · ${server.name}`} readOnly style={{ ...inputStyle, background: '#f7f8f8' }} /></label>
      <label>
        <span style={labelStyle}>Sistema del cliente</span>
        <select value={systemId} onChange={(e) => setSystemId(e.target.value ? Number(e.target.value) : '')} style={inputStyle}>
          <option value="">{systems === null ? 'Cargando…' : '(ninguno)'}</option>
          {/* El valor es el de la asignación (`client_systems.id`). */}
          {(systems ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label><span style={labelStyle}>Nombre *</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} style={inputStyle} /></label>
      <label>
        <span style={labelStyle}>Protocolo</span>
        <select value={protocol} onChange={(e) => setProtocol(e.target.value as Protocol)} style={inputStyle}>
          {PROTOCOL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label>
        <span style={labelStyle}>Destino *</span>
        <input value={target} onChange={(e) => setTarget(e.target.value)} maxLength={255} style={inputStyle} placeholder={protocol === 'HTTPS' ? 'https://…' : 'IP o nombre'} />
      </label>
      <label>
        <span style={labelStyle}>Puerto{protocol === 'TCP' ? ' *' : ''}</span>
        <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" style={inputStyle} />
      </label>
      <label><span style={labelStyle}>Umbral de latencia (ms)</span><input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="numeric" style={inputStyle} /></label>
      <label>
        <span style={labelStyle}>Criticidad</span>
        <select value={criticality} onChange={(e) => setCriticality(e.target.value as Criticality)} style={inputStyle}>
          {(Object.keys(CRITICALITY_LABELS) as Criticality[]).map((c) => <option key={c} value={c}>{CRITICALITY_LABELS[c]}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={btn} onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="button" style={btnPrimary} onClick={submit} disabled={!canSubmit}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </div>
  );
}
