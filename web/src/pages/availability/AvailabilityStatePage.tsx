import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { availabilityApi, CombinedStatus, StateFilter } from '../../api/availability.api';
import { clientsApi } from '../../api/clients.api';
import { toast } from '../../ui/Toast';
import {
  apiMessage, apiStatus, btn, fmtDateTime, fmtProbeSide, inputStyle, STATUS_COLORS, STATUS_LABELS, STATUS_OPTIONS, tableWrap, td, th,
} from './availability-ui';

/** Pausa del botón «Probar ahora»; el servidor aplica la misma. */
const CHECK_COOLDOWN_MS = 15_000;

export default function AvailabilityStatePage() {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState<number | ''>('');
  const [status, setStatus] = useState<CombinedStatus | ''>('');
  const [serverId, setServerId] = useState<number | ''>('');
  const [cooling, setCooling] = useState<ReadonlySet<number>>(new Set());
  const [exporting, setExporting] = useState(false);

  const filter: StateFilter = {
    ...(clientId !== '' ? { clientId } : {}),
    ...(status !== '' ? { status } : {}),
    ...(serverId !== '' ? { serverId } : {}),
  };

  const state = useQuery({
    queryKey: ['availability', 'state', filter],
    queryFn: () => availabilityApi.state(filter),
    refetchInterval: 15_000,
  });
  const clients = useQuery({ queryKey: ['availability', 'clients'], queryFn: () => clientsApi.list(), staleTime: 5 * 60_000 });
  const servers = useQuery({ queryKey: ['availability', 'servers'], queryFn: availabilityApi.listServers, staleTime: 60_000 });

  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.razonSocial])), [clients.data]);
  const serverOptions = (servers.data ?? []).filter((s) => clientId === '' || s.clientId === clientId);
  // Temporizadores vivos (pausa de 15 s y refresco tras la prueba): se cancelan al salir de la página.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const inFlight = useRef(new Set<number>());
  useEffect(() => {
    const t = timers.current;
    return () => { t.forEach(clearTimeout); t.clear(); };
  }, []);
  const later = (fn: () => void, ms: number) => {
    const h = setTimeout(() => { timers.current.delete(h); fn(); }, ms);
    timers.current.add(h);
  };

  const startCooldown = (id: number) => {
    setCooling((prev) => new Set(prev).add(id));
    later(() => {
      setCooling((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, CHECK_COOLDOWN_MS);
  };

  const checkNow = async (serviceId: number) => {
    if (cooling.has(serviceId) || inFlight.current.has(serviceId)) return;
    inFlight.current.add(serviceId);
    try {
      await availabilityApi.checkNow(serviceId);
      startCooldown(serviceId); // 202: el servidor también aplica la pausa
      toast.success('Comprobación solicitada a las dos sondas.');
      later(() => queryClient.invalidateQueries({ queryKey: ['availability', 'state'] }), 5_000);
    } catch (e) {
      if (apiStatus(e) === 429) {
        startCooldown(serviceId);
        toast.error('Espera unos segundos');
      } else {
        toast.error(apiMessage(e, 'No se pudo solicitar la comprobación.'));
      }
    } finally {
      inFlight.current.delete(serviceId);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await availabilityApi.downloadStateCsv(filter);
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo exportar el CSV.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="text-xl font-semibold text-slate-900">Estado de disponibilidad</h1>
        <button type="button" style={btn} onClick={exportCsv} disabled={exporting}>
          {exporting ? 'Exportando…' : 'Exportar CSV'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select
          aria-label="Cliente"
          value={clientId}
          onChange={(e) => { setClientId(e.target.value ? Number(e.target.value) : ''); setServerId(''); }}
          style={{ ...inputStyle, width: 'auto' }}
        >
          <option value="">Todos los clientes</option>
          {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}
        </select>
        <select aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value as CombinedStatus | '')} style={{ ...inputStyle, width: 'auto' }}>
          <option value="">Todos los estados</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select
          aria-label="Servidor"
          value={serverId}
          onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : '')}
          style={{ ...inputStyle, width: 'auto' }}
        >
          <option value="">Todos los servidores</option>
          {serverOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {state.isLoading && <div style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</div>}
      {state.error && <div role="alert" style={{ fontSize: 13, color: '#b3261e' }}>No se pudo cargar el estado.</div>}

      {state.data && (
        state.data.length === 0 ? (
          <div style={{ fontSize: 13, color: '#6d7577' }}>No hay servicios que coincidan. Los servicios se cargan en «Inventario».</div>
        ) : (
          <div style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', background: '#f7f8f8', color: '#6d7577', fontSize: 12 }}>
                  {['Servicio', 'Servidor', 'Cliente', 'Desde Perú', 'Desde servidor', 'Estado', 'Ticket', ''].map((h, n) => (
                    <th key={n} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.data.map((r) => {
                  const c = STATUS_COLORS[r.status];
                  return (
                    <tr key={r.serviceId} style={{ borderTop: '1px solid #eef0f1' }}>
                      <td style={{ ...td, fontWeight: 600 }}>{r.serviceName}</td>
                      <td style={td}>{r.serverName}</td>
                      <td style={td}>{clientName.get(r.clientId) ?? '—'}</td>
                      <td style={td} title={fmtDateTime(r.office?.lastCheckAt)}>{fmtProbeSide(r.office)}</td>
                      <td style={td} title={fmtDateTime(r.datacenter?.lastCheckAt)}>{fmtProbeSide(r.datacenter)}</td>
                      <td style={td}>
                        <span style={{ background: c.bg, color: c.fg, borderRadius: 4, padding: '2px 7px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {STATUS_LABELS[r.status]}
                        </span>
                      </td>
                      <td style={td}>
                        {r.incidentId !== null && (
                          <Link to={`/monitoreo/incidentes/${r.incidentId}`} className="text-blue-700 hover:underline">
                            {r.ticketCode ?? 'Incidente'}
                          </Link>
                        )}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          style={{ ...btn, ...(cooling.has(r.serviceId) ? { opacity: 0.6, cursor: 'not-allowed' } : null) }}
                          onClick={() => checkNow(r.serviceId)}
                          disabled={cooling.has(r.serviceId)}
                        >
                          Probar ahora
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
