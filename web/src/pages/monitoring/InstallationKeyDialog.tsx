import { useEffect, useState } from 'react';

import type { IssuedKey } from '../../api/monitoring.api';
import { toast } from '../../ui/Toast';

interface Props {
  /** La clave recién emitida; `null` = diálogo cerrado. */
  issued: IssuedKey | null;
  /** Al cerrar, quien lo abrió descarta la clave de su estado. */
  onClose: () => void;
}

/**
 * Enseña la clave en claro UNA vez. Solo vive en el estado de quien abre el
 * diálogo (nunca en la caché de react-query, la URL ni el almacenamiento) y se
 * descarta al cerrar: el servidor guarda solo su huella y no puede repetirla.
 */
export default function InstallationKeyDialog({ issued, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [issued]);

  // Escape solo cierra cuando la clave ya se copió con el botón. Antes de eso
  // se ignora: la clave no se puede volver a mostrar, y un Escape reflejo
  // (p. ej. para cerrar otra cosa) la perdería y obligaría a regenerarla. Quien
  // la copió a mano cierra con el botón explícito "Ya la copié, cerrar".
  useEffect(() => {
    if (!issued || !copied) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [issued, copied, onClose]);

  if (!issued) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.secret);
      setCopied(true);
    } catch {
      toast.error('No se pudo copiar: selecciona la clave y cópiala a mano.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="installation-key-title"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div style={{ background: '#fff', borderRadius: 10, padding: 22, width: 540, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 id="installation-key-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Clave de {issued.installation.displayName}
        </h2>
        <div
          role="alert"
          style={{ fontSize: 12, lineHeight: 1.5, borderRadius: 6, padding: '8px 10px', color: '#a35c00', background: '#fff4e0', border: '1px solid #f0d9a8', fontWeight: 600 }}
        >
          No se volverá a mostrar. Cópiala ahora y ponla en el <code>ApiKey</code> del log4net.config; si se pierde, hay que regenerarla.
        </div>
        <input
          readOnly
          value={issued.secret}
          aria-label="Clave de la instalación"
          onFocus={(e) => e.currentTarget.select()}
          style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13, padding: '9px 10px', border: '1px solid #dfe3e4', borderRadius: 6, width: '100%', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={copy}
            style={{ fontSize: 13, padding: '9px 14px', borderRadius: 7, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer' }}
          >
            {copied ? 'Copiada' : 'Copiar clave'}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: '#15191a', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            Ya la copié, cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
