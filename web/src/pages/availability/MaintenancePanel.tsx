import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { availabilityApi, MaintenanceStatus, MaintenanceView } from '../../api/availability.api';
import { useAuth } from '../../auth/AuthContext';
import { askConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../ui/Toast';
import { apiMessage, apiStatus, btn, btnPrimary, inputStyle, labelStyle, tableWrap, td, th } from './availability-ui';
import { fmtLima, isoToLimaInput, limaInputToIso } from './report-format';

const STATUS_TEXT: Record<MaintenanceStatus, string> = { SCHEDULED: 'Programado', ACTIVE: 'Activo', ENDED: 'Terminado' };
const STATUS_STYLE: Record<MaintenanceStatus, { bg: string; fg: string }> = {
  SCHEDULED: { bg: '#eef0f1', fg: '#6d7577' },
  ACTIVE: { bg: '#fff4e0', fg: '#a35c00' },
  ENDED: { bg: '#e6f4ea', fg: '#1e7a3c' },
};
const ORDER: Record<MaintenanceStatus, number> = { ACTIVE: 0, SCHEDULED: 1, ENDED: 2 };

/** Ventanas de mantenimiento: próximas, activas y de los últimos 30 días. Horas en Lima. */
export default function MaintenancePanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['availability', 'maintenance'], queryFn: () => availabilityApi.listMaintenance(), refetchInterval: 30_000 });
  const servers = useQuery({ queryKey: ['availability', 'servers'], queryFn: availabilityApi.listServers, staleTime: 60_000 });
  const services = useQuery({ queryKey: ['availability', 'services'], queryFn: () => availabilityApi.listServices(), staleTime: 60_000 });

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ['availability', 'maintenance'] });
    queryClient.invalidateQueries({ queryKey: ['availability', 'state'] });
  };

  const [target, setTarget] = useState(''); // «s:<id>» servidor, «v:<id>» servicio
  const [startsAt, setStartsAt] = useState(() => isoToLimaInput(new Date()));
  const [endsAt, setEndsAt] = useState(() => isoToLimaInput(new Date(Date.now() + 2 * 3600_000)));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeServers = (servers.data ?? []).filter((s) => s.status !== 'ARCHIVED');
  const activeServerIds = new Set(activeServers.map((s) => s.id));
  const activeServices = (services.data ?? []).filter((v) => v.status !== 'ARCHIVED' && activeServerIds.has(v.serverId));
  const serverName = new Map((servers.data ?? []).map((s) => [s.id, s.name]));
  const canSubmit = !busy && target !== '' && startsAt !== '' && endsAt !== '' && reason.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const id = Number(target.slice(2));
    try {
      await availabilityApi.createMaintenance({
        ...(target.startsWith('s:') ? { serverId: id } : { serviceId: id }),
        startsAt: limaInputToIso(startsAt),
        endsAt: limaInputToIso(endsAt),
        reason: reason.trim(),
      });
      toast.success('Mantenimiento programado.');
      setReason('');
      reload();
    } catch (e) {
      setError(apiMessage(e, 'No se pudo programar el mantenimiento.'));
    } finally {
      setBusy(false);
    }
  };

  const end = async (m: MaintenanceView) => {
    const ok = await askConfirm({
      title: 'Terminar el mantenimiento',
      message: `«${m.targetLabel}» vuelve a vigilarse desde ahora. ¿Continuar?`,
      tone: 'warning',
      confirmText: 'Terminar ahora',
    });
    if (!ok) return;
    try {
      await availabilityApi.endMaintenance(m.id);
      toast.success('Mantenimiento terminado.');
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo terminar el mantenimiento.'));
    }
    reload();
  };

  const remove = async (m: MaintenanceView) => {
    const ok = await askConfirm({
      title: 'Eliminar el mantenimiento',
      message: `Se elimina la ventana futura de «${m.targetLabel}».`,
      tone: 'danger',
      confirmText: 'Eliminar',
    });
    if (!ok) return;
    try {
      await availabilityApi.deleteMaintenance(m.id);
      toast.success('Mantenimiento eliminado.');
    } catch (e) {
      toast.error(apiStatus(e) === 409 ? 'La ventana ya empezó: usa «Terminar ahora».' : apiMessage(e, 'No se pudo eliminar el mantenimiento.'));
    }
    reload();
  };

  const rows = [...(list.data ?? [])].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === 'ENDED' ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt)),
  );

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Mantenimientos</h2>
      <div style={{ fontSize: 12, color: '#6d7577' }}>
        Durante una ventana no se abren incidentes ni cuenta como caída. Horas en hora de Lima. Se muestran los próximos, los activos y los de los últimos 30 días.
      </div>

      {isAdmin && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, border: '1px solid #e6e9ea', borderRadius: 8, padding: 12 }}>
          {error && <div role="alert" style={{ gridColumn: '1 / -1', fontSize: 12, borderRadius: 6, padding: '8px 10px', color: '#b3261e', background: '#fdecea' }}>{error}</div>}
          <label>
            <span style={labelStyle}>Servidor o servicio *</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} style={inputStyle}>
              <option value="">Elige…</option>
              <optgroup label="Servidor completo">
                {activeServers.map((s) => <option key={`s${s.id}`} value={`s:${s.id}`}>{s.name}</option>)}
              </optgroup>
              <optgroup label="Un servicio">
                {activeServices.map((v) => <option key={`v${v.id}`} value={`v:${v.id}`}>{serverName.get(v.serverId) ?? '—'} · {v.name}</option>)}
              </optgroup>
            </select>
          </label>
          <label><span style={labelStyle}>Inicio (Lima) *</span><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={inputStyle} /></label>
          <label><span style={labelStyle}>Fin (Lima) *</span><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={inputStyle} /></label>
          <label><span style={labelStyle}>Motivo *</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} style={inputStyle} /></label>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" style={btnPrimary} onClick={submit} disabled={!canSubmit}>{busy ? 'Guardando…' : 'Programar'}</button>
          </div>
        </div>
      )}

      {list.isLoading && <div style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</div>}
      {list.error && <div role="alert" style={{ fontSize: 13, color: '#b3261e' }}>No se pudieron cargar los mantenimientos.</div>}
      {list.data && (rows.length === 0 ? (
        <div style={{ fontSize: 13, color: '#6d7577' }}>No hay mantenimientos próximos, activos ni de los últimos 30 días.</div>
      ) : (
        <div style={tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', background: '#f7f8f8', color: '#6d7577', fontSize: 12 }}>
                {['Objetivo', 'Inicio (Lima)', 'Fin (Lima)', 'Motivo', 'Estado', ''].map((h, n) => <th key={n} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} style={{ borderTop: '1px solid #eef0f1' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{m.targetLabel}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtLima(m.startsAt)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtLima(m.endsAt)}</td>
                  <td style={td}>{m.reason}</td>
                  <td style={td}>
                    <span style={{ background: STATUS_STYLE[m.status].bg, color: STATUS_STYLE[m.status].fg, borderRadius: 4, padding: '2px 7px', fontSize: 12, fontWeight: 600 }}>{STATUS_TEXT[m.status]}</span>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {isAdmin && m.status === 'ACTIVE' && <button type="button" style={btn} onClick={() => end(m)}>Terminar ahora</button>}
                    {isAdmin && m.status === 'SCHEDULED' && <button type="button" style={{ ...btn, color: '#b3261e' }} onClick={() => remove(m)}>Eliminar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
