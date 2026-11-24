import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { devConnectorApi, DevLinkKind } from '../../api/dev-connector.api';
import { useRealtime } from '../../lib/realtime';

const KIND_LABEL: Record<DevLinkKind, string> = { BRANCH: 'Rama', COMMIT: 'Commit', PR: 'PR' };

const STATE_STYLE: Record<string, { bg: string; fg: string }> = {
  open: { bg: '#e7f5ec', fg: '#1d6b3a' },
  merged: { bg: '#efe8fb', fg: '#5b3aa0' },
  closed: { bg: '#f3f4f4', fg: '#6d7577' },
};

/**
 * «Código»: ramas, commits y PR que nombran este ticket o requerimiento
 * (webhook de GitHub o Claude vía MCP). Se refresca con el aviso en vivo
 * `tickets:changed` que el webhook emite al enlazar.
 */
export default function CodeLinksPanel({ target }: { target: { ticketId: number } | { workItemId: number } }) {
  const qc = useQueryClient();
  const key = ['dev-links', target];
  const links = useQuery({ queryKey: key, queryFn: () => devConnectorApi.links(target) });

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['dev-links'] });
  }, [qc]);
  useRealtime('tickets:changed', refresh);

  const rows = links.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {links.isLoading && <span style={{ fontSize: 12, color: '#6d7577' }}>Cargando…</span>}
      {!links.isLoading && rows.length === 0 && (
        <span style={{ fontSize: 12, color: '#6d7577' }}>
          Sin código asociado. Nombra el código en la rama o el commit (p. ej. <code>fix/KB-0210-…</code>).
        </span>
      )}
      {rows.map((l) => {
        const st = l.state ? STATE_STYLE[l.state] : null;
        const shown = l.kind === 'COMMIT' ? l.ref.slice(0, 7) : l.kind === 'PR' ? `#${l.ref}` : l.ref;
        return (
          <div key={l.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12 }}>
            <span style={{ minWidth: 52, color: '#6d7577', fontWeight: 600 }}>{KIND_LABEL[l.kind]}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.url ? (
                <a href={l.url} target="_blank" rel="noreferrer" style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>
                  {shown}
                </a>
              ) : (
                <code>{shown}</code>
              )}
              {l.title && <span style={{ color: '#4b5355' }}> · {l.title}</span>}
            </span>
            {st && (
              <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: st.bg, color: st.fg }}>{l.state}</span>
            )}
            <span style={{ fontSize: 11, color: '#9aa0a1', whiteSpace: 'nowrap' }}>
              {new Date(l.occurredAt).toLocaleDateString('es-PE')}
              {l.authorLogin ? ` · ${l.authorLogin}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
