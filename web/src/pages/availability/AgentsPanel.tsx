import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { availabilityApi, MonitorServer } from '../../api/availability.api';
import { clientsApi } from '../../api/clients.api';
import { useAuth } from '../../auth/AuthContext';
import { askConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../ui/Toast';
import { apiMessage, btn, btnPrimary, tableWrap, td, th } from './availability-ui';
import { fmtLima } from './report-format';

type Issued = { server: MonitorServer; token: string; installScript: string };

/** Agentes de servidor: emitir y revocar el token y bajar el instalador. */
export default function AgentsPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  // El token y el script en claro viven solo en este estado: nunca en la caché de react-query.
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(new Set());

  const servers = useQuery({ queryKey: ['availability', 'servers'], queryFn: availabilityApi.listServers, refetchInterval: 30_000 });
  const clients = useQuery({ queryKey: ['availability', 'clients'], queryFn: () => clientsApi.list(), staleTime: 5 * 60_000 });
  const clientName = new Map((clients.data ?? []).map((c) => [c.id, c.razonSocial]));
  const reload = () => queryClient.invalidateQueries({ queryKey: ['availability', 'servers'] });

  const setBusy = (id: number, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const issue = async (s: MonitorServer) => {
    if (busyIds.has(s.id)) return;
    setBusy(s.id, true);
    try {
      if (s.agentTokenCreatedAt) {
        const ok = await askConfirm({
          title: 'Emitir un token nuevo',
          message: `El token actual del agente de «${s.name}» dejará de valer y habrá que reinstalar el agente con el nuevo. ¿Continuar?`,
          tone: 'warning',
          confirmText: 'Emitir',
        });
        if (!ok) return;
      }
      try {
        const r = await availabilityApi.issueAgentToken(s.id);
        setIssued({ server: s, token: r.token, installScript: r.installScript });
      } catch (e) {
        toast.error(apiMessage(e, 'No se pudo emitir el token.'));
      }
      reload();
    } finally {
      setBusy(s.id, false);
    }
  };

  const revoke = async (s: MonitorServer) => {
    if (busyIds.has(s.id)) return;
    setBusy(s.id, true);
    try {
    const ok = await askConfirm({
      title: 'Revocar el token del agente',
      message: `El agente de «${s.name}» dejará de poder enviar muestras de inmediato.`,
      tone: 'danger',
      confirmText: 'Revocar',
    });
    if (!ok) return;
    try {
      await availabilityApi.revokeAgentToken(s.id);
      toast.success('Token revocado.');
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo revocar el token.'));
    }
    reload();
    } finally {
      setBusy(s.id, false);
    }
  };

  const list = (servers.data ?? []).filter((s) => s.status !== 'ARCHIVED');

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Agentes</h2>
      <div style={{ fontSize: 12, color: '#6d7577' }}>
        El agente de servidor reporta CPU, RAM, discos, IIS y servicios de Windows. Su estado se ve en «Servidores».
        {!isAdmin && ' Solo un administrador puede emitir o revocar tokens.'}
      </div>
      {servers.isLoading && <div style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</div>}
      {servers.error && <div role="alert" style={{ fontSize: 13, color: '#b3261e' }}>No se pudieron cargar los servidores.</div>}
      {servers.data && (
        <div style={tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', background: '#f7f8f8', color: '#6d7577', fontSize: 12 }}>
                {['Servidor', 'Última muestra (Lima)', 'Versión', 'Token', ''].map((h, n) => <th key={n} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid #eef0f1' }}>
                  <td style={td}>
                    <Link to={`/monitoreo/servidores?serverId=${s.id}`} className="text-blue-700 hover:underline" style={{ fontWeight: 600 }}>{s.name}</Link>
                    <div style={{ fontSize: 12, color: '#6d7577' }}>{clientName.get(s.clientId) ?? ''}</div>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtLima(s.agentLastSeenAt)}</td>
                  <td style={td}>{s.agentVersion ?? '—'}</td>
                  <td style={td}>{s.agentTokenCreatedAt ? `Emitido el ${fmtLima(s.agentTokenCreatedAt)}` : 'Sin token'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" style={btn} onClick={() => issue(s)} disabled={busyIds.has(s.id)}>Emitir token</button>
                        {s.agentTokenCreatedAt && <button type="button" style={{ ...btn, color: '#b3261e' }} onClick={() => revoke(s)} disabled={busyIds.has(s.id)}>Revocar</button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AgentTokenDialog issued={issued} onClose={() => setIssued(null)} />
    </section>
  );
}

/** Enseña el token en claro UNA vez y ofrece el instalador; mismo criterio que el de las sondas. */
function AgentTokenDialog({ issued, onClose }: { issued: Issued | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => { setCopied(false); setDownloaded(false); }, [issued]);

  useEffect(() => {
    if (!issued || !(copied || downloaded)) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [issued, copied, downloaded, onClose]);

  if (!issued) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
    } catch {
      toast.error('No se pudo copiar: selecciona el token y cópialo a mano.');
    }
  };
  const download = () => {
    availabilityApi.saveInstallScript(issued.installScript);
    setDownloaded(true);
  };
  const warn: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, borderRadius: 6, padding: '8px 10px', color: '#a35c00', background: '#fff4e0', border: '1px solid #f0d9a8' };
  const code: React.CSSProperties = { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="agent-token-title" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: 22, width: 600, maxWidth: '92vw', maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 id="agent-token-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Agente de {issued.server.name}</h2>
        <div role="alert" style={{ ...warn, fontWeight: 600 }}>
          No se volverá a mostrar. Descarga el instalador o copia el token ahora; si se pierde, hay que emitir otro.
        </div>
        <input
          readOnly
          value={issued.token}
          aria-label="Token del agente"
          onFocus={(e) => e.currentTarget.select()}
          style={{ ...code, fontSize: 13, padding: '9px 10px', border: '1px solid #dfe3e4', borderRadius: 6, width: '100%', boxSizing: 'border-box' }}
        />
        <div style={warn}>
          <div><strong>El script lleva el token en texto plano:</strong> bórralo del servidor y de «Descargas» después de instalar.</div>
          <div style={{ marginTop: 6 }}>
            Si Windows bloquea el .ps1 descargado, ejecútalo como administrador con{' '}
            <span style={code}>Unblock-File .\install-kubo-agent.ps1</span> o con{' '}
            <span style={code}>powershell -ExecutionPolicy Bypass -File .\install-kubo-agent.ps1</span>.
            {' '}Deja <span style={code}>kubo-agent.exe</span> en la misma carpeta que el script.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" onClick={download} style={btnPrimary}>{downloaded ? 'Descargado: bajar otra vez' : 'Descargar install-kubo-agent.ps1'}</button>
          <button type="button" onClick={copy} style={{ ...btn, fontSize: 13, padding: '9px 14px' }}>{copied ? 'Copiado' : 'Copiar token'}</button>
          <button type="button" onClick={onClose} style={{ ...btn, fontSize: 13, padding: '9px 14px' }}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
