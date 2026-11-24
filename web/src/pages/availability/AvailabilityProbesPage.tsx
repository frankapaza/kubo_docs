import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { availabilityApi, ProbeInfo } from '../../api/availability.api';
import { useAuth } from '../../auth/AuthContext';
import { askConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../ui/Toast';
import { apiMessage, btn, fmtDateTime, tableWrap, td, th } from './availability-ui';

const KIND_LABELS: Record<ProbeInfo['kind'], string> = { OFFICE: 'Oficina (Perú)', DATACENTER: 'Centro de datos' };

export default function AvailabilityProbesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  // El token en claro vive solo en este estado: nunca en la caché de react-query.
  const [issued, setIssued] = useState<{ probe: ProbeInfo; token: string } | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(new Set());

  const probes = useQuery({ queryKey: ['availability', 'probes'], queryFn: availabilityApi.listProbes, refetchInterval: 30_000 });
  const reload = () => queryClient.invalidateQueries({ queryKey: ['availability', 'probes'] });

  const setBusy = (id: number, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const issue = async (p: ProbeInfo) => {
    if (busyIds.has(p.id)) return;
    setBusy(p.id, true);
    try {
      if (p.hasToken) {
        const ok = await askConfirm({
          title: 'Emitir un token nuevo',
          message: `El token actual de «${p.code}» dejará de valer y la sonda tendrá que actualizarlo. ¿Continuar?`,
          tone: 'warning',
          confirmText: 'Emitir',
        });
        if (!ok) return;
      }
      try {
        setIssued({ probe: p, token: (await availabilityApi.issueProbeToken(p.id)).token });
      } catch (e) {
        toast.error(apiMessage(e, 'No se pudo emitir el token.'));
      }
      reload();
    } finally {
      setBusy(p.id, false);
    }
  };

  const revoke = async (p: ProbeInfo) => {
    const ok = await askConfirm({
      title: 'Revocar el token',
      message: `«${p.code}» dejará de poder enviar resultados de inmediato. Podrás emitir un token nuevo cuando quieras.`,
      tone: 'danger',
      confirmText: 'Revocar',
    });
    if (!ok) return;
    try {
      await availabilityApi.revokeProbeToken(p.id);
      toast.success('Token revocado.');
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo revocar el token.'));
    }
    reload();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="text-xl font-semibold text-slate-900">Sondas</h1>
      {!isAdmin && <div style={{ fontSize: 12, color: '#6d7577' }}>Solo un administrador puede emitir o revocar tokens.</div>}

      {probes.isLoading && <div style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</div>}
      {probes.error && <div role="alert" style={{ fontSize: 13, color: '#b3261e' }}>No se pudieron cargar las sondas.</div>}

      {probes.data && (
        <div style={tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', background: '#f7f8f8', color: '#6d7577', fontSize: 12 }}>
                {['Sonda', 'Última conexión', 'Versión', 'Desfase de reloj (aprox.)', 'Token', ''].map((h, n) => <th key={n} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {probes.data.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid #eef0f1' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{p.code}</div>
                    <div style={{ fontSize: 12, color: '#6d7577' }}>{KIND_LABELS[p.kind]}</div>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDateTime(p.lastSeenAt)}</td>
                  <td style={td}>{p.version ?? '—'}</td>
                  {/* Incluye hasta ~15 s de demora de subida: es una cota, no una medida exacta. */}
                  <td style={td} title="Incluye hasta unos 15 s de demora de subida">
                    {p.clockSkewMs === null ? '—' : `${(p.clockSkewMs / 1000).toFixed(1)} s`}
                  </td>
                  <td style={td}>{p.hasToken ? 'Emitido' : 'Sin token'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" style={btn} onClick={() => issue(p)} disabled={busyIds.has(p.id)}>Emitir token</button>
                        {p.hasToken && <button type="button" style={{ ...btn, color: '#b3261e' }} onClick={() => revoke(p)}>Revocar</button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProbeTokenDialog issued={issued} onClose={() => setIssued(null)} />
    </div>
  );
}

/** Enseña el token en claro UNA vez; sigue el mismo criterio que InstallationKeyDialog. */
function ProbeTokenDialog({ issued, onClose }: { issued: { probe: ProbeInfo; token: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => { setCopied(false); }, [issued]);

  useEffect(() => {
    if (!issued || !copied) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [issued, copied, onClose]);

  if (!issued) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
    } catch {
      toast.error('No se pudo copiar: selecciona el token y cópialo a mano.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="probe-token-title"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div style={{ background: '#fff', borderRadius: 10, padding: 22, width: 540, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 id="probe-token-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Token de {issued.probe.code}</h2>
        <div role="alert" style={{ fontSize: 12, lineHeight: 1.5, borderRadius: 6, padding: '8px 10px', color: '#a35c00', background: '#fff4e0', border: '1px solid #f0d9a8', fontWeight: 600 }}>
          No se volverá a mostrar. Cópialo ahora y ponlo en la configuración de la sonda; si se pierde, hay que emitir otro.
        </div>
        <input
          readOnly
          value={issued.token}
          aria-label="Token de la sonda"
          onFocus={(e) => e.currentTarget.select()}
          style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13, padding: '9px 10px', border: '1px solid #dfe3e4', borderRadius: 6, width: '100%', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={copy} style={{ fontSize: 13, padding: '9px 14px', borderRadius: 7, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer' }}>
            {copied ? 'Copiado' : 'Copiar token'}
          </button>
          <button type="button" onClick={onClose} style={{ fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: '#15191a', color: '#fff', border: 'none', cursor: 'pointer' }}>
            Ya lo copié, cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
