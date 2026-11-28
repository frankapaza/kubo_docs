import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { availabilityApi } from '../../api/availability.api';
import { toast } from '../../ui/Toast';

/**
 * Destinatarios de la alerta de latencia (spec 2026-11-28-alerta-latencia).
 * Vacío = administradores activos. Solo un ADMIN guarda.
 */
export default function LatencyAlertSettingsCard({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['availability', 'latency-alert-settings'], queryFn: availabilityApi.latencyAlertSettings });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings.data) setText(settings.data.emails.join(', '));
  }, [settings.data]);

  const save = async () => {
    const emails = text.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
    setBusy(true);
    try {
      const out = await availabilityApi.saveLatencyAlertSettings(emails);
      qc.setQueryData(['availability', 'latency-alert-settings'], out);
      toast.success(out.emails.length ? 'Destinatarios guardados.' : 'Sin destinatarios: avisará a los administradores.');
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      toast.error(Array.isArray(msg) ? msg[0] : msg ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ border: '1px solid #e6e9ea', borderRadius: 10, padding: 14, background: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>Alerta de latencia (ping desde la oficina)</div>
      <div style={{ fontSize: 12, color: '#6d7577' }}>
        Cada hora se revisan los pings de cada servidor. Si 20 % o más pasan de su umbral, llega un correo al empezar y otro al
        normalizarse, con la tabla hora por hora para el proveedor. Correos separados por coma; vacío = administradores activos.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          aria-label="Destinatarios de la alerta de latencia"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!isAdmin || settings.isLoading}
          placeholder="correo@kuboti.com, otro@kuboti.com"
          style={{ flex: '1 1 320px', fontSize: 13, padding: '6px 10px', border: '1px solid #d8dcdd', borderRadius: 6 }}
        />
        {isAdmin && (
          <button
            type="button"
            onClick={save}
            disabled={busy}
            style={{ fontSize: 13, padding: '6px 14px', borderRadius: 6, border: 'none', background: '#053777', color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>
    </div>
  );
}
