import { memo, useState } from 'react';

import type { LogLevel } from '../../api/monitoring.api';
import { LEVEL_STYLES } from './monitoring-ui';

/** Línea de búsqueda o en vivo: las de en vivo no traen `propiedades`. */
export interface LogRowData {
  key: string;
  ts: string;
  nivel: LogLevel;
  clienteId: number | null;
  aplicativo: string;
  servidor: string;
  logger: string;
  mensaje: string;
  excepcion: string | null;
  hilo: string | null;
  propiedades?: Record<string, string>;
}

const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

const ellipsis: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/**
 * Una línea de log. Todo el texto llega de aplicativos de terceros: se pinta
 * siempre como texto de React (nunca como HTML) y las excepciones, en `<pre>`.
 */
function LogLineRow({ line, clienteNombre }: { line: LogRowData; clienteNombre?: string | null }) {
  const [open, setOpen] = useState(false);
  const st = LEVEL_STYLES[line.nivel] ?? LEVEL_STYLES.INFO;
  const props = line.propiedades ? Object.entries(line.propiedades) : [];

  return (
    <div style={{ borderBottom: '1px solid #eef0f1', fontSize: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: 'flex', gap: 10, alignItems: 'baseline', width: '100%', textAlign: 'left',
          padding: '4px 8px', background: open ? '#f6f8f8' : 'transparent', border: 0, cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 'inherit',
        }}
      >
        <span style={{ fontFamily: 'monospace', color: '#6d7577', flex: 'none' }}>{fmtTime(line.ts)}</span>
        <span
          style={{
            flex: 'none', width: 52, textAlign: 'center', borderRadius: 4, padding: '1px 0',
            fontSize: 10, fontWeight: 700, background: st.bg, color: st.fg,
          }}
        >
          {line.nivel}
        </span>
        <span style={{ flex: 'none', maxWidth: 260, color: '#3a4041', ...ellipsis }}>
          {[clienteNombre, line.aplicativo, line.servidor].filter(Boolean).join(' · ')}
        </span>
        <span style={{ flex: 'none', maxWidth: 220, color: '#6d7577', ...ellipsis }}>{line.logger}</span>
        <span style={{ flex: 1, minWidth: 0, fontFamily: 'monospace', ...ellipsis }}>{line.mensaje}</span>
      </button>
      {open && (
        <div style={{ padding: '6px 12px 10px 24px', background: '#f6f8f8', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ color: '#6d7577' }}>Hilo: {line.hilo ?? '—'}</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{line.mensaje}</pre>
          {line.excepcion && (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, color: '#b3261e', maxHeight: 360, overflow: 'auto' }}>
              {line.excepcion}
            </pre>
          )}
          {props.length > 0 && (
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 12px' }}>
              {props.map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt style={{ color: '#6d7577' }}>{k}</dt>
                  <dd style={{ margin: 0, wordBreak: 'break-word' }}>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(LogLineRow);
