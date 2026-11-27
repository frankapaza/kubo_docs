import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  WORK_ITEM_DOC_KIND_LABELS,
  WorkItemDoc,
  WorkItemDocKind,
  workItemDocsApi,
} from '../../api/work-items.api';
import { toast } from '../../ui/Toast';

const KINDS: WorkItemDocKind[] = ['ESPECIFICACION', 'MANUAL_USUARIO', 'ACTA_CONFORMIDAD', 'OTRO'];

const ACCEPT = '.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif';

function apiError(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const smallButton: React.CSSProperties = {
  fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--k-border)', background: '#fff', cursor: 'pointer',
};

/**
 * Los documentos del requerimiento: Especificación (al aceptar), Manual de
 * usuario (al entregar; Claude lo deja como borrador) y Acta de conformidad
 * (al cerrar). Lo que dejó Claude se marca como borrador hasta que alguien lo apruebe.
 */
export default function WorkItemDocumentsPanel({ workItemId, onChanged }: { workItemId: number; onChanged?: () => void }) {
  const qc = useQueryClient();
  const key = ['work-item-docs', workItemId];
  const docs = useQuery({ queryKey: key, queryFn: () => workItemDocsApi.list(workItemId) });
  const [kind, setKind] = useState<WorkItemDocKind>('ESPECIFICACION');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    onChanged?.();
  };

  const upload = useMutation({
    mutationFn: (file: File) => workItemDocsApi.upload(workItemId, kind, file),
    onSuccess: (d) => {
      toast.success(`${d.kindLabel} adjuntado`);
      refresh();
    },
    onError: (e) => toast.error(apiError(e, 'No se pudo subir el documento.')),
    onSettled: () => {
      if (fileRef.current) fileRef.current.value = '';
    },
  });

  const approve = useMutation({
    mutationFn: (d: WorkItemDoc) => workItemDocsApi.approve(workItemId, d.id),
    onSuccess: () => {
      toast.success('Documento aprobado');
      refresh();
    },
    onError: (e) => toast.error(apiError(e, 'No se pudo aprobar.')),
  });

  const remove = useMutation({
    mutationFn: (d: WorkItemDoc) => workItemDocsApi.remove(workItemId, d.id),
    onSuccess: refresh,
    onError: (e) => toast.error(apiError(e, 'No se pudo quitar.')),
  });

  const list = docs.data ?? [];
  const sinEspec = !docs.isLoading && !list.some((d) => d.kind === 'ESPECIFICACION' && d.status === 'VIGENTE');
  const busy = upload.isPending || approve.isPending || remove.isPending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sinEspec && (
        <div style={{ fontSize: 12, padding: '8px 10px', borderRadius: 6, background: '#fff7e6', color: '#8a5a00', border: '1px solid #f3dca8' }}>
          Falta la <strong>Especificación del requerimiento</strong> (Word o PDF): es lo que Claude y el equipo leen antes de programar.
        </div>
      )}

      {docs.isLoading && <div style={{ fontSize: 12, color: 'var(--k-muted)' }}>Cargando…</div>}
      {docs.isError && <div style={{ fontSize: 12, color: 'oklch(0.5 0.16 25)' }}>No se pudieron cargar los documentos.</div>}

      {list.map((d) => (
        <div
          key={d.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, fontSize: 12,
            border: `1px solid ${d.status === 'BORRADOR' ? '#f3dca8' : 'var(--k-border-soft)'}`,
            background: d.status === 'BORRADOR' ? '#fffbf2' : '#fff',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.filename}>
              {d.filename}
            </div>
            <div style={{ color: 'var(--k-muted)', fontSize: 11 }}>
              {d.source === 'CLIENTE' && (
                <span
                  style={{
                    display: 'inline-block', marginRight: 6, padding: '0 6px', borderRadius: 4,
                    background: '#e3ecfb', color: '#1d4e9e', fontWeight: 700,
                  }}
                >
                  Del cliente
                </span>
              )}
              {d.source === 'CLIENTE' ? 'Adjunto' : d.kindLabel} · {sizeLabel(d.sizeBytes)} · {new Date(d.createdAt).toLocaleDateString('es-PE')}
              {d.source === 'CLAUDE' && ' · vía Claude'}
              {d.status === 'BORRADOR' && <strong style={{ color: '#8a5a00' }}> · Borrador por revisar</strong>}
            </div>
          </div>
          <button type="button" style={smallButton} onClick={() => workItemDocsApi.download(workItemId, d).catch(() => toast.error('No se pudo descargar.'))}>
            Descargar
          </button>
          {d.status === 'BORRADOR' && (
            <button type="button" disabled={busy} style={{ ...smallButton, background: 'var(--k-primary)', color: '#fff', border: 'none' }} onClick={() => approve.mutate(d)}>
              Aprobar
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            style={smallButton}
            onClick={() => window.confirm(`¿Quitar «${d.filename}»?`) && remove.mutate(d)}
          >
            Quitar
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as WorkItemDocKind)}
          aria-label="Tipo de documento"
          style={{ fontSize: 12, padding: '5px 8px', border: '1px solid var(--k-border)', borderRadius: 6 }}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>{WORK_ITEM_DOC_KIND_LABELS[k]}</option>
          ))}
        </select>
        <button type="button" disabled={busy} style={{ ...smallButton, fontSize: 12, padding: '5px 10px' }} onClick={() => fileRef.current?.click()}>
          {upload.isPending ? 'Subiendo…' : 'Adjuntar documento'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--k-muted)' }}>PDF, Word (.docx) o imagen · hasta 15 MB</span>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
          }}
        />
      </div>
    </div>
  );
}
