import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { conformityApi, ConformityActa, CreateConformityBody } from '../../api/work-items.api';
import { clientUsersApi } from '../../api/client-users.api';
import { documentsApi } from '../../api/documents.api';
import { toast } from '../../ui/Toast';

function apiError(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(m) ? m.join('; ') : m ?? fallback;
}

const FECHA = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' });

const input: React.CSSProperties = {
  fontSize: 12, padding: '6px 8px', border: '1px solid #dfe3e4', borderRadius: 6, width: '100%', boxSizing: 'border-box',
};
const button: React.CSSProperties = {
  fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid #dfe3e4', background: '#fff', cursor: 'pointer',
};
const primary: React.CSSProperties = { ...button, background: '#15191a', color: '#fff', border: 'none', fontWeight: 600 };

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  SENT: { label: 'Enviada a firma', bg: '#fff7e6', fg: '#8a5a00' },
  SIGNED: { label: 'Firmada', bg: '#e8f6ee', fg: '#1d6b3f' },
  DRAFT: { label: 'Borrador', bg: '#f1f3f3', fg: '#4a5052' },
  CANCELLED: { label: 'Anulada', bg: '#f1f3f3', fg: '#6d7577' },
  EXPIRED: { label: 'Vencida', bg: '#fdecec', fg: '#9b2c2c' },
};

/**
 * Acta de conformidad: se genera con el requerimiento en Pruebas y se envía al
 * cliente para firmar por enlace. Cuando firma, el PDF firmado queda en
 * Documentos y el requerimiento pasa a Cerrado solo.
 */
export default function WorkItemConformityPanel({
  workItemId,
  clientId,
  status,
  onChanged,
}: {
  workItemId: number;
  clientId: number;
  status: string;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const key = ['work-item-conformity', workItemId];
  const acta = useQuery({ queryKey: key, queryFn: () => conformityApi.get(workItemId) });
  const users = useQuery({
    queryKey: ['client-users', clientId],
    queryFn: () => clientUsersApi.listByClient(clientId),
    retry: false,
  });
  const [form, setForm] = useState<CreateConformityBody>({ signerName: '', signerEmail: '', signerRole: '', observaciones: '' });

  const after = (a: ConformityActa | null, ok: string) => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['work-item-docs', workItemId] });
    onChanged?.();
    if (a?.emailError) toast.error(a.emailError);
    else toast.success(ok);
  };

  const create = useMutation({
    mutationFn: () =>
      conformityApi.create(workItemId, {
        signerName: form.signerName.trim(),
        signerEmail: form.signerEmail.trim(),
        signerRole: form.signerRole?.trim() || undefined,
        observaciones: form.observaciones?.trim() || undefined,
      }),
    onSuccess: (a) => after(a, `Acta enviada a ${form.signerEmail.trim()} para firma`),
    onError: (e) => toast.error(apiError(e, 'No se pudo generar el acta.')),
  });
  const resend = useMutation({
    mutationFn: () => conformityApi.resend(workItemId),
    onSuccess: (a) => after(a, 'Enlace de firma reenviado'),
    onError: (e) => toast.error(apiError(e, 'No se pudo reenviar.')),
  });
  const cancel = useMutation({
    mutationFn: () => conformityApi.cancel(workItemId),
    onSuccess: () => after(null, 'Acta anulada'),
    onError: (e) => toast.error(apiError(e, 'No se pudo anular.')),
  });

  if (acta.isLoading) return <div style={{ fontSize: 12, color: '#6d7577' }}>Cargando…</div>;

  const a = acta.data;
  const busy = create.isPending || resend.isPending || cancel.isPending;

  if (a && a.status !== 'CANCELLED') {
    const st = STATUS[a.status] ?? STATUS.DRAFT;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: st.bg, color: st.fg }}>{st.label}</span>
          <span style={{ color: '#6d7577' }}>generada el {FECHA.format(new Date(a.createdAt))}</span>
        </div>
        {a.signatories.map((s) => (
          <div key={s.id} style={{ padding: '8px 10px', border: '1px solid #eceeef', borderRadius: 6 }}>
            <strong>{s.fullName}</strong>
            {s.role ? ` · ${s.role}` : ''} · {s.email ?? 'sin correo'}
            <div style={{ color: s.status === 'SIGNED' ? '#1d6b3f' : '#8a5a00', marginTop: 2 }}>
              {s.status === 'SIGNED' && s.signedAt
                ? `Firmó el ${FECHA.format(new Date(s.signedAt))}`
                : `Pendiente de firma${s.tokenExpiresAt ? ` · el enlace vence el ${FECHA.format(new Date(s.tokenExpiresAt))}` : ''}`}
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" style={button} onClick={() => documentsApi.downloadPdf(a.documentId, `${a.title}.pdf`).catch(() => toast.error('No se pudo descargar.'))}>
            Ver acta (PDF)
          </button>
          {a.status !== 'SIGNED' && (
            <>
              <button type="button" style={button} disabled={busy} onClick={() => resend.mutate()}>
                {resend.isPending ? 'Enviando…' : 'Reenviar enlace'}
              </button>
              <button
                type="button"
                style={button}
                disabled={busy}
                onClick={() => window.confirm('¿Anular el acta? El enlace deja de servir para cerrar el requerimiento y podrás generar otra.') && cancel.mutate()}
              >
                Anular
              </button>
            </>
          )}
        </div>
        {a.status === 'SIGNED' && (
          <div style={{ color: '#6d7577' }}>El PDF firmado está en Documentos y el requerimiento se cerró.</div>
        )}
      </div>
    );
  }

  if (status !== 'PRUEBAS') {
    return (
      <div style={{ fontSize: 12, color: '#6d7577' }}>
        Se genera cuando el requerimiento está en <strong>Pruebas</strong>: el cliente lo firma por enlace y, al firmar, el
        requerimiento se cierra.
      </div>
    );
  }

  const activos = (users.data ?? []).filter((u) => u.isActive);
  const ready = form.signerName.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.signerEmail.trim());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <div style={{ color: '#6d7577' }}>
        DevDocs arma el acta con los criterios de aceptación, el código entregado y los documentos vigentes, y se la envía
        al cliente para firmar por enlace. Al firmar, el requerimiento pasa a <strong>Cerrado</strong>.
      </div>
      {activos.length > 0 && (
        <select
          aria-label="Usuario del cliente que firma"
          style={input}
          value=""
          onChange={(e) => {
            const u = activos.find((x) => String(x.id) === e.target.value);
            if (u) setForm((f) => ({ ...f, signerName: u.fullName, signerEmail: u.email }));
          }}
        >
          <option value="">Elegir un usuario del cliente…</option>
          {activos.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName} · {u.email}</option>
          ))}
        </select>
      )}
      <input style={input} placeholder="Nombre de quien firma" value={form.signerName} onChange={(e) => setForm({ ...form, signerName: e.target.value })} />
      <input style={input} placeholder="Correo de quien firma" value={form.signerEmail} onChange={(e) => setForm({ ...form, signerEmail: e.target.value })} />
      <input style={input} placeholder="Cargo (opcional)" value={form.signerRole} onChange={(e) => setForm({ ...form, signerRole: e.target.value })} />
      <textarea
        style={{ ...input, minHeight: 54, resize: 'vertical' }}
        placeholder="Observaciones (opcional)"
        value={form.observaciones}
        onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
      />
      <div>
        <button type="button" style={{ ...primary, opacity: ready && !busy ? 1 : 0.5 }} disabled={!ready || busy} onClick={() => create.mutate()}>
          {create.isPending ? 'Enviando…' : 'Generar y enviar a firma'}
        </button>
      </div>
    </div>
  );
}
