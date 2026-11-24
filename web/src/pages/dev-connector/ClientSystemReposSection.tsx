import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { devConnectorApi, IssuedRepoSecret, webhookUrl } from '../../api/dev-connector.api';
import { useAuth } from '../../auth/AuthContext';
import { canManageUsers } from '../../auth/permissions';
import { toast } from '../../ui/Toast';
import SecretOnceDialog from './SecretOnceDialog';

const smallButton = {
  fontSize: 12,
  padding: '5px 10px',
  borderRadius: 6,
  background: '#fff',
  border: '1px solid #d8dcdd',
  cursor: 'pointer',
} as const;

function apiError(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

/**
 * Repos de GitHub de una asignación cliente-sistema (conector de Claude).
 * Registrar, desactivar y regenerar el secreto es de ADMIN (lo exige el
 * servidor); el resto del personal ve la lista.
 */
export default function ClientSystemReposSection({ clientSystemId, systemName }: { clientSystemId: number; systemName: string }) {
  const { user } = useAuth();
  const isAdmin = canManageUsers(user);
  const qc = useQueryClient();
  const key = ['dev-repos', clientSystemId];
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<IssuedRepoSecret | null>(null);

  const repos = useQuery({ queryKey: key, queryFn: () => devConnectorApi.listRepos(clientSystemId) });

  const register = useMutation({
    mutationFn: () => devConnectorApi.registerRepo(clientSystemId, name),
    onSuccess: (out) => {
      setName('');
      setIssued(out);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(apiError(e, 'No se pudo registrar el repositorio.')),
  });

  const toggle = useMutation({
    mutationFn: (r: { id: number; isActive: boolean }) => devConnectorApi.setRepoActive(r.id, !r.isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(apiError(e, 'No se pudo cambiar el repositorio.')),
  });

  const regenerate = useMutation({
    mutationFn: (id: number) => devConnectorApi.regenerateWebhookSecret(id),
    onSuccess: (out) => setIssued(out),
    onError: (e) => toast.error(apiError(e, 'No se pudo regenerar el secreto.')),
  });

  return (
    <div style={{ marginLeft: 16, padding: '6px 0 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#6d7577', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Repositorios de {systemName}
      </span>

      {repos.isLoading && <span style={{ fontSize: 12, color: '#6d7577' }}>Cargando…</span>}
      {repos.data?.length === 0 && (
        <span style={{ fontSize: 12, color: '#6d7577' }}>
          Sin repositorios: Claude no puede trabajar los tickets de este sistema.
        </span>
      )}
      {repos.data?.map((r) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
          <a href={r.githubUrl} target="_blank" rel="noreferrer" style={{ flex: 1, color: r.isActive ? '#15191a' : '#9aa0a1' }}>
            {r.githubFullName}
            {!r.isActive && ' (inactivo)'}
          </a>
          {isAdmin && (
            <>
              <button type="button" style={smallButton} disabled={regenerate.isPending}
                onClick={() => {
                  if (window.confirm(`El secreto actual de ${r.githubFullName} dejará de valer: habrá que pegar el nuevo en GitHub. ¿Continuar?`)) {
                    regenerate.mutate(r.id);
                  }
                }}>
                Regenerar secreto
              </button>
              <button type="button" style={smallButton} disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>
                {r.isActive ? 'Desactivar' : 'Activar'}
              </button>
            </>
          )}
        </div>
      ))}

      {isAdmin && (
        <form
          style={{ display: 'flex', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) register.mutate();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="owner/repo o https://github.com/owner/repo.git"
            aria-label={`Repositorio de ${systemName}`}
            style={{ flex: 1, fontSize: 12, padding: '6px 9px', border: '1px solid #dfe3e4', borderRadius: 6 }}
          />
          <button type="submit" style={smallButton} disabled={register.isPending || !name.trim()}>
            Registrar repo
          </button>
        </form>
      )}

      <SecretOnceDialog
        open={issued !== null}
        title={`Webhook de ${issued?.repo.githubFullName ?? ''}`}
        warning="El secreto no se volverá a mostrar. Pégalo ahora en GitHub; si se pierde, regénéralo."
        fields={issued ? [
          { label: 'Secret', value: issued.secret },
          { label: 'Payload URL', value: webhookUrl() },
        ] : []}
        onClose={() => setIssued(null)}
      >
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: '#4b5355' }}>
          <li>
            En <a href={`${issued?.repo.githubUrl}/settings/hooks/new`} target="_blank" rel="noreferrer">GitHub → Settings → Webhooks → Add webhook</a>{' '}
            (requiere ser admin del repo).
          </li>
          <li>Payload URL y Secret: los de arriba. Content type: <code>application/json</code>.</li>
          <li>Eventos: <em>Let me select</em> → <strong>Pushes</strong>, <strong>Branch or tag creation</strong>, <strong>Pull requests</strong>.</li>
        </ol>
      </SecretOnceDialog>
    </div>
  );
}
