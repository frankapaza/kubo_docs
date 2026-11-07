import { useEffect, useRef, useState } from 'react';

import { clientsApi } from '../../api/clients.api';
import {
  CreateTicketFromErrorBody,
  CreateTicketFromErrorResult,
  ErrorGroupView,
  monitoringApi,
  TICKET_LINK_FAILED,
} from '../../api/monitoring.api';
import { clientSystemsApi } from '../../api/tickets.api';
import type { Client, ClientSystem } from '../../api/types';
import { toast } from '../../ui/Toast';
import { ELIGE_SISTEMA, ELIGE_SISTEMA_OPCION } from '../tickets/system-field';

interface Props {
  open: boolean;
  group: ErrorGroupView;
  onCancel: () => void;
  onCreated: (result: CreateTicketFromErrorResult) => void;
  /** El ticket ya existe (409) o quedó creado sin enlazar (500): la pantalla recarga el grupo. */
  onStale: () => void;
}

const inputStyle: React.CSSProperties = {
  fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6,
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 5, display: 'block' };

interface ApiErr { response?: { status?: number; data?: { code?: string; message?: string } } }

export default function CreateTicketFromErrorDialog({ open, group, onCancel, onCreated, onStale }: Props) {
  // El grupo trae cliente y sistema: no hay nada que preguntar. Si el backend
  // aun así pide el sistema, `forceSystem` abre el selector.
  const complete = group.clientId !== null && group.systemId !== null;
  const [forceSystem, setForceSystem] = useState(false);
  const [clientId, setClientId] = useState<number | ''>('');
  const [systemId, setSystemId] = useState<number | ''>('');
  const [clients, setClients] = useState<Client[]>([]);
  const [systems, setSystems] = useState<ClientSystem[]>([]);
  const [systemsLoaded, setSystemsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemMarked, setSystemMarked] = useState(false);
  // Ticket creado pero sin enlazar: el diálogo se queda para que se lea qué ticket es.
  const [linkFailed, setLinkFailed] = useState(false);
  const inFlight = useRef(false);

  const askSystem = !complete || forceSystem;
  const askClient = group.clientId === null;
  const effectiveClientId = group.clientId ?? (clientId === '' ? null : clientId);

  useEffect(() => {
    if (!open) return;
    setForceSystem(false);
    setClientId('');
    setSystemId('');
    setError(null);
    setSystemMarked(false);
    setLinkFailed(false);
  }, [open, group.id]);

  useEffect(() => {
    if (!open || !askClient) return;
    let cancelled = false;
    clientsApi
      .list({ status: 'CLIENT' })
      .then((l) => { if (!cancelled) setClients(l); })
      .catch(() => { if (!cancelled) setClients([]); });
    return () => { cancelled = true; };
  }, [open, askClient]);

  useEffect(() => {
    setSystemsLoaded(false);
    setSystems([]);
    if (!open || !askSystem || effectiveClientId === null) return;
    let cancelled = false;
    clientSystemsApi
      .list(effectiveClientId)
      .then((l) => {
        if (cancelled) return;
        const activos = l.filter((s) => s.isActive === 1);
        setSystems(activos);
        setSystemsLoaded(true);
        // Si hay un único sistema ya queda elegido, igual que en el alta de tickets.
        if (activos.length === 1) setSystemId(activos[0].id);
      })
      .catch(() => { if (!cancelled) setSystemsLoaded(true); });
    return () => { cancelled = true; };
  }, [open, askSystem, effectiveClientId]);

  const dismiss = () => {
    if (busy) return;
    if (linkFailed) onStale();
    else onCancel();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy, linkFailed]);

  if (!open) return null;

  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const body: CreateTicketFromErrorBody = {};
    if (askClient && clientId !== '') body.clientId = clientId;
    if (askSystem && systemId !== '') body.systemId = systemId;
    try {
      const result = await monitoringApi.createTicketFromError(group.id, body);
      onCreated(result);
    } catch (e) {
      const err = e as ApiErr;
      const status = err.response?.status;
      const data = err.response?.data;
      if (status === 409) {
        toast.warning(data?.message ?? 'Este error ya tiene un ticket.');
        onStale();
      } else if (status === 400 && data?.message === ELIGE_SISTEMA) {
        // El grupo no resolvía el sistema: se pide aquí y el diálogo se queda.
        setForceSystem(true);
        setSystemMarked(true);
        setError(ELIGE_SISTEMA);
      } else if (status === 500 && data?.code === TICKET_LINK_FAILED) {
        setLinkFailed(true);
        setError(data?.message ?? 'El ticket se creó pero no se pudo enlazar al error.');
      } else {
        setError(data?.message ?? 'No se pudo crear el ticket.');
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const canSubmit = !busy && !linkFailed && (!askSystem || effectiveClientId === null || systemId !== '' || (systemsLoaded && systems.length === 0));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-ticket-error-title"
      onClick={dismiss}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, padding: 22, width: 480, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <h2 id="create-ticket-error-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Crear ticket desde el error</h2>

        {!askSystem && !askClient && !linkFailed && (
          <span style={{ fontSize: 13, color: '#3a4041', lineHeight: 1.5 }}>
            Se creará un ticket para <b>{group.clientName}</b> · <b>{group.systemName}</b> con el detalle de este error.
          </span>
        )}

        {error && (
          <div
            role="alert"
            style={{
              fontSize: 12, lineHeight: 1.5, borderRadius: 6, padding: '8px 10px',
              color: 'oklch(0.5 0.16 25)', background: 'oklch(0.96 0.02 25)', border: '1px solid oklch(0.88 0.05 25)',
              fontWeight: linkFailed ? 600 : 400,
            }}
          >
            {error}
          </div>
        )}

        {!linkFailed && (askClient || askSystem) && (
          <div style={{ display: 'grid', gap: 12 }}>
            {askClient ? (
              <label htmlFor="err-ticket-client">
                <span style={labelStyle}>Cliente (opcional)</span>
                <select
                  id="err-ticket-client"
                  value={clientId}
                  onChange={(e) => { setClientId(e.target.value ? Number(e.target.value) : ''); setSystemId(''); setSystemMarked(false); }}
                  style={inputStyle}
                >
                  <option value="">(sin cliente)</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}
                </select>
              </label>
            ) : (
              <div style={{ fontSize: 13 }}>
                <span style={labelStyle}>Cliente</span>
                {group.clientName}
              </div>
            )}

            {askSystem && effectiveClientId !== null && (
              <label htmlFor="err-ticket-system">
                <span style={labelStyle}>Sistema afectado *</span>
                {systemsLoaded && systems.length === 0 ? (
                  <span style={{ fontSize: 12, color: '#6d7577', lineHeight: 1.4 }}>
                    Este cliente no tiene sistemas asignados. El ticket se creará sin clasificar.
                  </span>
                ) : (
                  <select
                    id="err-ticket-system"
                    value={systemId}
                    aria-invalid={systemMarked && systemId === ''}
                    onChange={(e) => { setSystemId(e.target.value ? Number(e.target.value) : ''); setSystemMarked(false); }}
                    style={{ ...inputStyle, ...(systemMarked && systemId === '' ? { borderColor: '#b3261e', boxShadow: '0 0 0 2px #fdecea' } : {}) }}
                  >
                    <option value="">{systemsLoaded ? ELIGE_SISTEMA_OPCION : 'Cargando…'}</option>
                    {/* El valor es el de la asignación (`client_systems.id`), lo que el backend valida. */}
                    {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </label>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {linkFailed ? (
            <button
              type="button"
              onClick={dismiss}
              style={{ fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: '#15191a', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Entendido
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={dismiss}
                disabled={busy}
                style={{ fontSize: 13, padding: '9px 14px', borderRadius: 7, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                style={{ fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: canSubmit ? '#15191a' : '#c9cdce', color: '#fff', border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed' }}
              >
                {busy ? 'Creando…' : 'Crear ticket'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
