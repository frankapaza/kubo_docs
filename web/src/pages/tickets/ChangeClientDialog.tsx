import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { clientsApi } from '../../api/clients.api';
import { clientSystemsApi } from '../../api/tickets.api';
import { clientUsersApi } from '../../api/client-users.api';

interface Props {
  open: boolean;
  currentClientId: number | null;
  onCancel: () => void;
  onConfirm: (v: { clientId: number; systemId: number | null; clientUserId: number | null }) => void;
}

const selectStyle: React.CSSProperties = {
  fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6, width: '100%', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 };

/**
 * POST /tickets/:id/client (solo ADMIN). El sistema es obligatorio si el
 * cliente nuevo tiene alguno activo; el usuario es a quien le llegarán los
 * avisos del ticket por correo (puede quedar en «ninguno»).
 */
export default function ChangeClientDialog({ open, currentClientId, onCancel, onConfirm }: Props) {
  const [clientId, setClientId] = useState<number | ''>('');
  const [systemId, setSystemId] = useState<number | ''>('');
  const [clientUserId, setClientUserId] = useState<number | ''>('');

  useEffect(() => {
    if (!open) return;
    setClientId('');
    setSystemId('');
    setClientUserId('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const clients = useQuery({ queryKey: ['clients', 'all'], queryFn: () => clientsApi.list(), enabled: open });
  const systems = useQuery({
    queryKey: ['client-systems', clientId],
    queryFn: () => clientSystemsApi.list(Number(clientId)),
    enabled: open && clientId !== '',
  });
  const users = useQuery({
    queryKey: ['client-users', clientId],
    queryFn: () => clientUsersApi.listByClient(Number(clientId)),
    enabled: open && clientId !== '',
  });

  if (!open) return null;

  const activeSystems = (systems.data ?? []).filter((s) => Number(s.isActive) === 1);
  const activeUsers = (users.data ?? []).filter((u) => u.isActive);
  const needsSystem = activeSystems.length > 0;
  const ready = clientId !== '' && Number(clientId) !== Number(currentClientId) && (!needsSystem || systemId !== '');

  const pickClient = (v: string) => {
    setClientId(v ? Number(v) : '');
    setSystemId('');
    setClientUserId('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-dialog-title"
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, padding: 22, width: 480, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <h2 id="client-dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Cambiar cliente
        </h2>

        <label htmlFor="change-client">
          <span style={labelStyle}>Cliente nuevo</span>
          <select id="change-client" value={clientId} onChange={(e) => pickClient(e.target.value)} style={selectStyle}>
            <option value="">Elige un cliente…</option>
            {(clients.data ?? [])
              .filter((c) => Number(c.id) !== Number(currentClientId))
              .map((c) => (
                <option key={c.id} value={c.id}>{c.razonSocial}</option>
              ))}
          </select>
        </label>

        {clientId !== '' && (
          <>
            <label htmlFor="change-client-system">
              <span style={labelStyle}>Sistema{needsSystem ? '' : ' (el cliente no tiene sistemas activos)'}</span>
              <select
                id="change-client-system"
                value={systemId}
                disabled={!needsSystem}
                onChange={(e) => setSystemId(e.target.value ? Number(e.target.value) : '')}
                style={selectStyle}
              >
                <option value="">{needsSystem ? 'Elige el sistema…' : '—'}</option>
                {activeSystems.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>

            <label htmlFor="change-client-user">
              <span style={labelStyle}>Usuario del cliente que recibe los avisos</span>
              <select
                id="change-client-user"
                value={clientUserId}
                onChange={(e) => setClientUserId(e.target.value ? Number(e.target.value) : '')}
                style={selectStyle}
              >
                <option value="">Ninguno (no se le escribe al cliente)</option>
                {activeUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName} · {u.email}</option>
                ))}
              </select>
            </label>
          </>
        )}

        <p style={{ margin: 0, fontSize: 12, color: '#6d7577', lineHeight: 1.5 }}>
          El ticket conserva su código, estado, conversación y SLA. Deja de verse en el portal del cliente anterior y
          pasa a verse en el del nuevo. Si tenía un proyecto del cliente anterior, se suelta.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onCancel}
            style={{ fontSize: 13, padding: '8px 14px', borderRadius: 6, border: '1px solid #d8dcdd', background: '#fff', cursor: 'pointer' }}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() =>
              ready &&
              onConfirm({
                clientId: Number(clientId),
                systemId: systemId === '' ? null : Number(systemId),
                clientUserId: clientUserId === '' ? null : Number(clientUserId),
              })
            }
            style={{
              fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 6, border: 'none',
              background: ready ? '#15191a' : '#c9cdce', color: '#fff', cursor: ready ? 'pointer' : 'not-allowed',
            }}
          >
            Mover ticket
          </button>
        </div>
      </div>
    </div>
  );
}
