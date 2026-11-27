import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { clientsApi } from '../../api/clients.api';
import { claudeMcpCommand, devConnectorApi, DevKeyView, IssuedDevKey } from '../../api/dev-connector.api';
import { ClientTag } from '../work-items/client-colors';
import { toast } from '../../ui/Toast';
import SecretOnceDialog from './SecretOnceDialog';

function apiError(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-PE') : '—');
const norm = (s: string) => s.trim().toLowerCase();
const selectStyle: React.CSSProperties = { fontSize: 13, padding: '8px 10px', border: '1px solid var(--k-border)', borderRadius: 6 };

/**
 * «Mis claves de desarrollo»: una clave `kdev_` por repo para conectar Claude
 * Code a los tickets de ese cliente y sistema. Guía: docs/integracion/conector-tickets-claude.md.
 */
export default function DevKeysPage() {
  const qc = useQueryClient();
  const [repoId, setRepoId] = useState<number | ''>('');
  const [issued, setIssued] = useState<IssuedDevKey | null>(null);
  const [clientFilter, setClientFilter] = useState('');

  const keys = useQuery({ queryKey: ['dev-keys'], queryFn: devConnectorApi.myKeys });
  const repos = useQuery({ queryKey: ['dev-repos', 'all'], queryFn: () => devConnectorApi.listRepos() });
  const activeRepos = useMemo(() => (repos.data ?? []).filter((r) => r.isActive), [repos.data]);
  // Solo para el color de cada cliente: la clave trae el nombre, no el id.
  const clients = useQuery({ queryKey: ['clients', 'all'], queryFn: () => clientsApi.list(), staleTime: 5 * 60_000 });
  const clientIdByName = useMemo(() => new Map((clients.data ?? []).map((c) => [norm(c.razonSocial), c.id])), [clients.data]);

  const clientNames = useMemo(
    () => [...new Set((keys.data ?? []).map((k) => k.clientName))].sort((a, b) => a.localeCompare(b, 'es')),
    [keys.data],
  );
  // Agrupadas por cliente; dentro, las activas primero y luego por sistema.
  const groups = useMemo(() => {
    const byClient = new Map<string, DevKeyView[]>();
    for (const k of keys.data ?? []) {
      if (clientFilter && k.clientName !== clientFilter) continue;
      byClient.set(k.clientName, [...(byClient.get(k.clientName) ?? []), k]);
    }
    return [...byClient.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([client, list]) => ({
        client,
        keys: list.sort((a, b) =>
          (a.status === b.status ? 0 : a.status === 'ACTIVA' ? -1 : 1) ||
          a.systemName.localeCompare(b.systemName, 'es') ||
          a.repoFullName.localeCompare(b.repoFullName)),
      }));
  }, [keys.data, clientFilter]);

  const issue = useMutation({
    mutationFn: (id: number) => devConnectorApi.issueKey(id),
    onSuccess: (out) => {
      setIssued(out);
      setRepoId('');
      qc.invalidateQueries({ queryKey: ['dev-keys'] });
    },
    onError: (e) => toast.error(apiError(e, 'No se pudo crear la clave.')),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => devConnectorApi.revokeKey(id),
    onSuccess: () => {
      toast.success('Clave revocada.');
      qc.invalidateQueries({ queryKey: ['dev-keys'] });
    },
    onError: (e) => toast.error(apiError(e, 'No se pudo revocar la clave.')),
  });

  return (
    <div style={{ padding: 24, maxWidth: 980, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Mis claves de desarrollo</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--k-muted)', lineHeight: 1.5 }}>
          Cada clave conecta Claude Code, dentro de un repositorio, con los tickets y requerimientos de su cliente y
          sistema. Crea una por repo y por laptop; si la pierdes o cambias de equipo, revócala y crea otra.
        </p>
      </div>

      <form
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (repoId !== '') issue.mutate(repoId);
        }}
      >
        <select
          value={repoId}
          onChange={(e) => setRepoId(e.target.value ? Number(e.target.value) : '')}
          aria-label="Repositorio"
          style={{ ...selectStyle, minWidth: 320 }}
        >
          <option value="">Elige un repositorio registrado…</option>
          {activeRepos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.githubFullName}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={repoId === '' || issue.isPending}
          style={{ fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 6, background: repoId === '' ? 'var(--k-disabled)' : 'var(--k-primary)', color: '#fff', border: 'none', cursor: repoId === '' ? 'not-allowed' : 'pointer' }}
        >
          Nueva clave
        </button>
        {activeRepos.length === 0 && !repos.isLoading && (
          <span style={{ fontSize: 12, color: 'var(--k-muted)' }}>
            No hay repos registrados: un administrador los registra en Clientes → Sistemas.
          </span>
        )}
      </form>

      {clientNames.length > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} aria-label="Filtrar por cliente" style={{ ...selectStyle, minWidth: 220 }}>
            <option value="">Todos los clientes</option>
            {clientNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {clientFilter && (
            <button type="button" onClick={() => setClientFilter('')} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, background: '#fff', border: '1px solid var(--k-border-strong)', cursor: 'pointer' }}>
              Quitar filtro
            </button>
          )}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--k-muted)', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={{ padding: '8px 6px' }}>Repositorio</th>
            <th style={{ padding: '8px 6px' }}>Sistema</th>
            <th style={{ padding: '8px 6px' }}>Clave</th>
            <th style={{ padding: '8px 6px' }}>Último uso</th>
            <th style={{ padding: '8px 6px' }}>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {keys.isLoading && (
            <tr><td colSpan={6} style={{ padding: 10, color: 'var(--k-muted)' }}>Cargando…</td></tr>
          )}
          {keys.data?.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 10, color: 'var(--k-muted)' }}>Aún no tienes claves.</td></tr>
          )}
          {groups.map((g) => {
            const clientId = clientIdByName.get(norm(g.client));
            const active = g.keys.filter((k) => k.status === 'ACTIVA').length;
            return [
              <tr key={`h-${g.client}`}>
                <td colSpan={6} style={{ padding: '16px 6px 6px', borderBottom: '1px solid var(--k-border)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {clientId !== undefined
                      ? <ClientTag clientId={clientId} name={g.client} />
                      : <strong style={{ fontSize: 12 }}>{g.client}</strong>}
                    <span style={{ fontSize: 12, color: 'var(--k-muted)' }}>
                      {active} {active === 1 ? 'activa' : 'activas'}{g.keys.length > active ? ` · ${g.keys.length - active} revocadas` : ''}
                    </span>
                  </span>
                </td>
              </tr>,
              ...g.keys.map((k) => (
            <tr key={k.id} style={{ borderTop: '1px solid var(--k-border-soft)', color: k.status === 'REVOCADA' ? 'var(--k-faint)' : undefined }}>
              <td style={{ padding: '8px 6px' }}>{k.repoFullName}</td>
              <td style={{ padding: '8px 6px' }}>{k.systemName}</td>
              <td style={{ padding: '8px 6px', fontFamily: 'ui-monospace, Consolas, monospace' }}>{k.keyPrefix}…</td>
              <td style={{ padding: '8px 6px' }}>{fmt(k.lastUsedAt)}</td>
              <td style={{ padding: '8px 6px' }}>{k.status === 'ACTIVA' ? 'Activa' : 'Revocada'}</td>
              <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                {k.status === 'ACTIVA' && (
                  <button
                    type="button"
                    disabled={revoke.isPending}
                    onClick={() => {
                      if (window.confirm(`La clave ${k.keyPrefix}… dejará de funcionar al instante. ¿Revocar?`)) revoke.mutate(k.id);
                    }}
                    style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: '#fff', border: '1px solid var(--k-border-strong)', cursor: 'pointer' }}
                  >
                    Revocar
                  </button>
                )}
              </td>
            </tr>
              )),
            ];
          })}
        </tbody>
      </table>

      <SecretOnceDialog
        open={issued !== null}
        title={`Clave para ${issued?.key.repoFullName ?? ''}`}
        warning="La clave no se volverá a mostrar. Ejecuta el comando ahora dentro de la carpeta del repo; si la pierdes, revócala y crea otra."
        fields={issued ? [
          { label: 'Comando (ejecútalo dentro de la carpeta del repo)', value: claudeMcpCommand(issued.secret) },
          { label: 'Clave', value: issued.secret },
        ] : []}
        onClose={() => setIssued(null)}
      >
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--k-ink-2)' }}>
          Requiere el MCP instalado en la laptop (<code>git clone</code> de <code>kubo-devdocs-mcp</code> en
          <code> C:\kubo</code>, luego <code>npm ci</code> y <code>npm run build</code>). Después abre Claude en esa carpeta y
          escribe <code>/mcp</code>: debe aparecer <strong>kubo-devdocs</strong> conectado.
        </p>
      </SecretOnceDialog>
    </div>
  );
}
