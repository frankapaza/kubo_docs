import { useEffect, useState } from 'react';

import {
  portalApi,
  PORTAL_TICKET_SUBJECT_MAX_LENGTH,
  PORTAL_TICKET_DESCRIPTION_MAX_LENGTH,
} from '../../api/portal.api';
import type { PortalClientSystem, PortalTicket } from '../../api/types';
import { Button } from '../../components/ui/Button';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreated: (ticket: PortalTicket) => void;
}

export default function NewPortalTicketDialog({ open, onCancel, onCreated }: Props) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [systemId, setSystemId] = useState<number | ''>('');
  const [systems, setSystems] = useState<PortalClientSystem[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resetea el formulario cada vez que el diálogo se abre; se mantiene
  // montado (mismo patrón que NewTicketDialog del panel interno) para no
  // perder el listener de Escape entre aperturas.
  useEffect(() => {
    if (!open) return;
    setSubject('');
    setDescription('');
    setSystemId('');
    setError(null);
  }, [open]);

  // `listSystems` solo devuelve los sistemas activos del cliente y es
  // opcional para el alta: si falla, el select queda vacío pero el usuario
  // puede seguir creando el ticket sin sistema. No es una escritura, así que
  // el fallo se registra en consola y no bloquea el formulario — a
  // diferencia del fallo de `submit`, que sí debe ver el usuario.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    portalApi
      .listSystems()
      .then((list) => {
        if (!cancelled) setSystems(list);
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('[NewPortalTicketDialog] No se pudo cargar la lista de sistemas.', e);
          setSystems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Cerrar con Escape — mismo idioma que los diálogos del panel interno.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const canSubmit = subject.trim().length > 0 && description.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) {
      setError('El asunto y la descripción son obligatorios.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await portalApi.createTicket({
        subject: subject.trim(),
        description: description.trim(),
        systemId: systemId || undefined,
      });
      onCreated(created);
    } catch (e: any) {
      // Fallo de escritura: el ticket NO se creó. Se muestra en el propio
      // diálogo (no en consola) para que quede claro que hay que reintentar,
      // a diferencia del fallo silencioso de `listSystems` de arriba.
      setError(e?.response?.data?.message ?? 'No se pudo crear el ticket. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-portal-ticket-title"
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      style={{ paddingTop: '6vh' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-pop"
      >
        <h2 id="new-portal-ticket-title" className="text-lg font-semibold text-slate-900">
          Nuevo ticket
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Cuéntanos qué necesitas; nuestro equipo lo revisará y te dará seguimiento.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <div className="mt-4 space-y-4">
          <div>
            <label className="label" htmlFor="portal-ticket-subject">
              Asunto *
            </label>
            <input
              id="portal-ticket-subject"
              className="input"
              type="text"
              value={subject}
              maxLength={PORTAL_TICKET_SUBJECT_MAX_LENGTH}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Resumen breve de tu solicitud"
            />
          </div>

          <div>
            <label className="label" htmlFor="portal-ticket-description">
              Descripción *
            </label>
            <textarea
              id="portal-ticket-description"
              className="input"
              rows={5}
              value={description}
              maxLength={PORTAL_TICKET_DESCRIPTION_MAX_LENGTH}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe el problema o la solicitud con el mayor detalle posible"
            />
          </div>

          <div>
            <label className="label" htmlFor="portal-ticket-system">
              Sistema (opcional)
            </label>
            <select
              id="portal-ticket-system"
              className="input"
              value={systemId}
              onChange={(e) => setSystemId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">(sin sistema)</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={submit} disabled={busy || !canSubmit} loading={busy}>
            {busy ? 'Creando…' : 'Crear ticket'}
          </Button>
        </div>
      </div>
    </div>
  );
}
