import { useEffect, useState } from 'react';

import { clientSystemsApi, systemsApi } from '../../api/tickets.api';
import type { ClientSystem, System } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { canManageClientSystems } from '../../auth/permissions';

/**
 * Los sistemas asignados a un cliente. Vive dentro de la pestaña «Sistemas» de
 * ClientDetailPage.
 *
 * Los sistemas ya no se teclean: se eligen del catálogo (`/systems`), que es
 * uno para todos los clientes. Así el mismo producto se llama igual en todas
 * las empresas que lo arriendan y el total de tickets por sistema suma.
 *
 * Asignar, desactivar y quitar son de ADMIN y PRODUCT_OWNER (la guarda del
 * servidor es la que manda). A quien no puede, la pestaña se le pinta de solo
 * lectura: un botón que siempre responde 403 enseña a no fiarse de los botones.
 */
export default function ClientSystemsTab({ clientId }: { clientId: number }) {
  const { user } = useAuth();
  const canManage = canManageClientSystems(user);

  const [systems, setSystems] = useState<ClientSystem[]>([]);
  const [catalog, setCatalog] = useState<System[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | ''>('');
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

  // El catálogo solo hace falta para asignar: quien no puede, no lo pide.
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    systemsApi
      .list()
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('[ClientSystemsTab] No se pudo cargar el catálogo de sistemas.', e);
          setError(e?.response?.data?.message ?? 'No se pudo cargar el catálogo de sistemas');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  // Sin catch propio: una falla de refresco debe distinguirse de una falla de
  // escritura (ver safeReload), así que se deja propagar.
  const reload = () => clientSystemsApi.list(clientId).then((data) => setSystems(data));

  const REFRESH_FAILED_MSG =
    'La acción se guardó, pero la lista no se pudo actualizar. Recarga la página para verla al día.';

  // La escritura ya tuvo éxito cuando esto se llama: si el GET de refresco
  // falla (red, 5xx transitorio), la fila puede "rebotar" a su valor anterior
  // aunque el cambio quedó guardado en el servidor. Sin este aviso separado, el
  // usuario ve el estado divergir de lo que realmente pasó.
  const safeReload = async () => {
    try {
      await reload();
    } catch (e) {
      console.warn('[ClientSystemsTab] La acción se guardó, pero no se pudo refrescar la lista.', e);
      setError(REFRESH_FAILED_MSG);
    }
  };

  /**
   * Una escritura con su manejo de errores. Los 409 del backend («ya lo tiene
   * asignado», «tiene tickets de este sistema…») vienen escritos en español y
   * dicen qué hacer en su lugar: se enseñan tal cual.
   */
  const write = async (action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e: any) {
      console.warn('[ClientSystemsTab] La escritura falló.', e);
      setError(e?.response?.data?.message ?? fallback);
      setBusy(false);
      return false;
    }
    await safeReload();
    setBusy(false);
    return true;
  };

  const assign = async () => {
    if (selected === '') return;
    const ok = await write(
      () => clientSystemsApi.create(clientId, { systemId: Number(selected) }),
      'No se pudo asignar el sistema',
    );
    if (ok) setSelected('');
  };

  const toggle = (s: ClientSystem) =>
    write(
      () => clientSystemsApi.update(clientId, s.id, { isActive: s.isActive === 0 }),
      'No se pudo actualizar el sistema',
    );

  const unassign = (s: ClientSystem) =>
    write(() => clientSystemsApi.remove(clientId, s.id), 'No se pudo quitar el sistema');

  // Lo que se puede asignar: lo que la casa sigue ofreciendo y este cliente
  // todavía no tiene. Por valor (`Number`), porque los ids llegan de la base.
  const assigned = new Set(systems.map((s) => Number(s.systemId)));
  const assignable = catalog.filter((c) => c.isActive === 1 && !assigned.has(Number(c.id)));

  const smallButton: React.CSSProperties = {
    fontSize: 12,
    padding: '5px 10px',
    borderRadius: 5,
    background: '#fff',
    border: '1px solid #d8dcdd',
    cursor: busy ? 'not-allowed' : 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {canManage && (
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : '')}
            aria-label="Sistema del catálogo a asignar"
            disabled={busy || assignable.length === 0}
            style={{ flex: 1, fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6, background: '#fff' }}
          >
            <option value="">
              {assignable.length === 0
                ? 'No quedan sistemas del catálogo por asignar'
                : '(elige un sistema del catálogo)'}
            </option>
            {assignable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={assign}
            disabled={busy || selected === ''}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '8px 14px',
              borderRadius: 6,
              background: busy || selected === '' ? '#c9cdce' : '#15191a',
              color: '#fff',
              border: 'none',
              cursor: busy || selected === '' ? 'not-allowed' : 'pointer',
            }}
          >
            Asignar
          </button>
        </div>
      )}

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
          Este cliente no tiene sistemas asignados. Sus tickets se podrán crear igualmente, pero
          quedarán sin clasificar: no se podrán agrupar por sistema ni en la bandeja ni en su
          informe mensual.
        </span>
      )}

      {!loading &&
        !loadError &&
        systems.map((s) => (
          <div
            key={s.id}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid #f1f3f3' }}
          >
            <span style={{ flex: 1, fontSize: 13, color: s.isActive ? '#15191a' : '#9aa0a1' }}>
              {s.name}
              {!s.isActive && ' (inactivo)'}
            </span>
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => toggle(s)}
                  disabled={busy}
                  aria-label={`${s.isActive ? 'Desactivar' : 'Activar'} sistema ${s.name}`}
                  style={smallButton}
                >
                  {s.isActive ? 'Desactivar' : 'Activar'}
                </button>
                <button
                  type="button"
                  onClick={() => unassign(s)}
                  disabled={busy}
                  aria-label={`Quitar sistema ${s.name}`}
                  title="Solo si se asignó por error y no tiene tickets. Si el cliente dejó de usarlo, desactívalo."
                  style={smallButton}
                >
                  Quitar
                </button>
              </>
            )}
          </div>
        ))}
    </div>
  );
}
