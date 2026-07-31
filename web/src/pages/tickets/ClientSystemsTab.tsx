import { useEffect, useState } from 'react';

import { clientSystemsApi } from '../../api/tickets.api';
import type { ClientSystem } from '../../api/types';

/**
 * Catálogo de sistemas de un cliente. Vive dentro de la pestaña «Sistemas»
 * de ClientDetailPage. Mutaciones abiertas a cualquier usuario autenticado
 * (ClientSystemsController no tiene @Roles), a diferencia de los técnicos.
 */
export default function ClientSystemsTab({ clientId }: { clientId: number }) {
  const [systems, setSystems] = useState<ClientSystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // `cancelled` evita que una carga obsoleta (p. ej. tras cambiar rápido de
  // cliente) pise el estado de la vista actual — mismo idioma que
  // TicketDetailPage/TicketsListPage.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    clientSystemsApi
      .list(clientId)
      .then((data) => {
        if (!cancelled) setSystems(data);
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('[ClientSystemsTab] No se pudieron cargar los sistemas del cliente.', e);
          setLoadError(e?.response?.data?.message ?? 'No se pudieron cargar los sistemas');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const reload = () =>
    clientSystemsApi
      .list(clientId)
      .then((data) => setSystems(data))
      .catch((e) => {
        console.warn('[ClientSystemsTab] No se pudo recargar los sistemas del cliente.', e);
      });

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await clientSystemsApi.create(clientId, { name: name.trim() });
      setName('');
      await reload();
    } catch (e: any) {
      // El backend responde 409 CONFLICT con { code, message } cuando el
      // nombre ya existe para este cliente; se muestra tal cual, no un error crudo.
      setError(e?.response?.data?.message ?? 'No se pudo crear el sistema');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: ClientSystem) => {
    setBusy(true);
    setError(null);
    try {
      await clientSystemsApi.update(clientId, s.id, { isActive: s.isActive === 0 });
      await reload();
    } catch (e: any) {
      console.warn('[ClientSystemsTab] No se pudo cambiar el estado del sistema.', e);
      setError(e?.response?.data?.message ?? 'No se pudo actualizar el sistema');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Nombre del sistema (ej. ERP Core)"
          aria-label="Nombre del nuevo sistema"
          disabled={busy}
          style={{ flex: 1, fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6 }}
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !name.trim()}
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: '8px 14px',
            borderRadius: 6,
            background: busy || !name.trim() ? '#c9cdce' : '#15191a',
            color: '#fff',
            border: 'none',
            cursor: busy || !name.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          Añadir
        </button>
      </div>

      {error && (
        <span role="alert" style={{ fontSize: 12, color: 'oklch(0.5 0.16 25)' }}>
          {error}
        </span>
      )}

      {loading && <span style={{ fontSize: 12, color: '#6d7577' }}>Cargando…</span>}
      {loadError && (
        <span role="alert" style={{ fontSize: 12, color: 'oklch(0.5 0.16 25)' }}>
          {loadError}
        </span>
      )}

      {!loading && !loadError && systems.length === 0 && (
        <span style={{ fontSize: 12, color: '#6d7577' }}>
          Este cliente no tiene sistemas registrados. Los tickets podrán crearse igualmente, pero
          el informe no podrá agruparse por sistema.
        </span>
      )}

      {!loading &&
        !loadError &&
        systems.map((s) => (
          <div
            key={s.id}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid #f1f3f3' }}
          >
            <span style={{ flex: 1, fontSize: 13, color: s.isActive ? '#15191a' : '#9aa0a1' }}>{s.name}</span>
            <button
              type="button"
              onClick={() => toggle(s)}
              disabled={busy}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 5, background: '#fff', border: '1px solid #d8dcdd', cursor: busy ? 'not-allowed' : 'pointer' }}
            >
              {s.isActive ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        ))}
    </div>
  );
}
