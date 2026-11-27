import { useEffect } from 'react';

import type { AppenderManual } from '../../api/monitoring.api';
import { toast } from '../../ui/Toast';

interface Props {
  open: boolean;
  manual: AppenderManual | undefined;
  loading: boolean;
  failed: boolean;
  onClose: () => void;
}

/** Siempre en claro: el manual trae un modo oscuro que en pantalla y en PDF se ve mal aquí. */
const LIGHT_CSS = `<style>
  html, body { background: #fff !important; color: #1f2933 !important; }
  h1, h2 { border-color: #e4e7eb !important; }
  pre, code, th { background: #f4f6f8 !important; border-color: #e4e7eb !important; }
  th, td { border-color: #d9dee3 !important; }
  pre { white-space: pre-wrap; word-break: break-word; }
  @media print { body { max-width: none; padding: 0; } h2, h3 { break-after: avoid; } pre, table { break-inside: avoid; } }
</style>`;

/**
 * Abre el manual en una ventana aparte y lanza el diálogo de impresión, donde
 * se elige «Guardar como PDF». El HTML se trata como no confiable: la CSP
 * prohíbe todo script, y la ventana nueva no conserva acceso a esta.
 */
function downloadPdf(manual: AppenderManual) {
  const w = window.open('', '_blank');
  if (!w) {
    toast.error('El navegador bloqueó la ventana. Permite ventanas emergentes para docs.kuboti.com.');
    return;
  }
  w.opener = null;
  const head =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">` +
    `<title>Manual Kubo Log4Net v${manual.version}</title>`;
  const html = /<head[^>]*>/i.test(manual.html)
    ? manual.html.replace(/<head[^>]*>/i, (m) => m + head).replace(/<\/head>/i, `${LIGHT_CSS}</head>`)
    : `<!doctype html><html><head><meta charset="utf-8">${head}${LIGHT_CSS}</head><body>${manual.html}</body></html>`;
  // El <title> del manual (si trae uno) va después y ganaría: se quita.
  const clean = html.replace(/(<\/title>[\s\S]*?)<title>[\s\S]*?<\/title>/i, '$1');
  w.document.open();
  w.document.write(clean);
  w.document.close();
  w.focus();
  // Un instante para que el navegador maquete antes de imprimir.
  setTimeout(() => w.print(), 300);
}

export default function AppenderManualDialog({ open, manual, loading, failed, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="appender-manual-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(16,35,47,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
    >
      <div style={{ background: '#fff', borderRadius: 12, width: 960, maxWidth: '100%', height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 50px rgba(16,35,47,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--k-border)' }}>
          <h2 id="appender-manual-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            Manual de implementación{manual ? ` · v${manual.version}` : ''}
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={!manual}
              onClick={() => manual && downloadPdf(manual)}
              style={{ fontSize: 13, fontWeight: 600, padding: '7px 12px', borderRadius: 7, background: 'var(--k-primary)', color: '#fff', border: 'none', cursor: manual ? 'pointer' : 'default', opacity: manual ? 1 : 0.6 }}
            >
              Descargar PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{ fontSize: 13, padding: '7px 12px', borderRadius: 7, background: '#fff', border: '1px solid var(--k-border-strong)', cursor: 'pointer' }}
            >
              Cerrar
            </button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {loading && <div style={{ padding: 16, fontSize: 13, color: 'var(--k-muted)' }}>Cargando…</div>}
          {failed && <div role="alert" style={{ padding: 16, fontSize: 13, color: '#b3261e' }}>No se pudo cargar el manual.</div>}
          {manual && (
            // sandbox vacío: sin scripts ni mismo origen. El manual es HTML generado y se trata como no confiable.
            <iframe
              title="Manual de implementación del appender"
              sandbox=""
              srcDoc={manual.html.replace(/<\/head>/i, `${LIGHT_CSS}</head>`)}
              style={{ width: '100%', height: '100%', border: 'none', background: '#fff', colorScheme: 'light' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
