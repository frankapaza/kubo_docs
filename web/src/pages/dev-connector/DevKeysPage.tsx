import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { claudeMcpCommand, devConnectorApi, IssuedDevKey } from '../../api/dev-connector.api';
import { toast } from '../../ui/Toast';
import SecretOnceDialog from './SecretOnceDialog';

function apiError(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-PE') : '—');

/**
 * «Mis claves de desarrollo»: una clave `kdev_` por repo para conectar Claude
 * Code a los tickets de ese cliente y sistema. Guía: docs/integracion/conector-tickets-claude.md.
 */
export default function DevKeysPage() {
  const qc = useQueryClient();
  const [repoId, setRepoId] = useState<number | ''>('');
  const [issued, setIssued] = useState<IssuedDevKey | null>(null);

  const keys = useQuery({ queryKey: ['dev-keys'], queryFn: devConnectorApi.myKeys });
  const repos = useQuery({ queryKey: ['dev-repos', 'all'], queryFn: () => devConnectorApi.listRepos() });
  const activeRepos = useMemo(() => (repos.data ?? []).filter((r) => r.isActive), [repos.data]);

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
          style={{ fontSize: 13, padding: '8px 10px', border: '1px solid var(--k-border)', borderRadius: 6, minWidth: 320 }}
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

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--k-muted)', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={{ padding: '8px 6px' }}>Repositorio</th>
            <th style={{ padding: '8px 6px' }}>Cliente · Sistema</th>
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
          {keys.data?.map((k) => (
            <tr key={k.id} style={{ borderTop: '1px solid var(--k-border-soft)', color: k.status === 'REVOCADA' ? 'var(--k-faint)' : undefined }}>
              <td style={{ padding: '8px 6px' }}>{k.repoFullName}</td>
              <td style={{ padding: '8px 6px' }}>{k.clientName} · {k.systemName}</td>
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
          ))}
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
