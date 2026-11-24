import { ReactNode, useEffect, useState } from 'react';

import { toast } from '../../ui/Toast';

export interface SecretField {
  label: string;
  value: string;
}

interface Props {
  open: boolean;
  title: string;
  /** Qué hacer con lo que se muestra; se pinta como aviso. */
  warning: ReactNode;
  /** Campos a copiar. El primero es el secreto que no se vuelve a mostrar. */
  fields: SecretField[];
  /** Instrucciones extra bajo los campos. */
  children?: ReactNode;
  onClose: () => void;
}

/**
 * Muestra un secreto UNA vez (clave `kdev_`, secreto del webhook). Mismo
 * criterio que `InstallationKeyDialog`: vive solo en el estado de quien lo
 * abre, Escape no cierra hasta haber copiado el secreto, y se descarta al cerrar.
 */
export default function SecretOnceDialog({ open, title, warning, fields, children, onClose }: Props) {
  const [copied, setCopied] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setCopied({});
  }, [open, fields]);

  useEffect(() => {
    if (!open || !copied[0]) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, copied, onClose]);

  if (!open) return null;

  const copy = async (i: number, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied((c) => ({ ...c, [i]: true }));
    } catch {
      toast.error('No se pudo copiar: selecciónalo y cópialo a mano.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="secret-once-title"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div style={{ background: '#fff', borderRadius: 10, padding: 22, width: 640, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 id="secret-once-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          {title}
        </h2>
        <div
          role="alert"
          style={{ fontSize: 12, lineHeight: 1.5, borderRadius: 6, padding: '8px 10px', color: '#a35c00', background: '#fff4e0', border: '1px solid #f0d9a8', fontWeight: 600 }}
        >
          {warning}
        </div>
        {fields.map((f, i) => (
          <label key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#4b5355' }}>
            {f.label}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                readOnly
                value={f.value}
                aria-label={f.label}
                onFocus={(e) => e.currentTarget.select()}
                style={{ flex: 1, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6, minWidth: 0 }}
              />
              <button
                type="button"
                onClick={() => copy(i, f.value)}
                style={{ fontSize: 12, padding: '8px 12px', borderRadius: 6, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {copied[i] ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </label>
        ))}
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: '#15191a', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            Ya lo copié, cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
