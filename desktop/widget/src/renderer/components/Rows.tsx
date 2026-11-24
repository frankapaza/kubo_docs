import type { WidgetRow } from '../../shared/widget-model';
import { TONE_COLORS } from '../palette';

function open(row: WidgetRow): void {
  if (row.incidentId !== null) window.kubo.openIncident(row.incidentId);
  else window.kubo.openDashboard();
}

interface RowProps {
  row: WidgetRow;
  child?: boolean;
  unfolded?: boolean;
  onToggle?: () => void;
}

function Row({ row, child = false, unfolded = false, onToggle }: RowProps) {
  const c = TONE_COLORS[row.tone];
  const hasChildren = row.children.length > 0;
  return (
    <>
      <div className={`row${child ? ' child' : ''}`} style={{ background: c.bg }}>
        <span className="mark" style={{ color: c.fg }}>{row.tone === 'red' ? '✕' : '!'}</span>
        <button type="button" className="row-main" onClick={() => open(row)} title="Abrir el incidente en la web">
          <span className="row-title" style={{ color: c.fg }}>{row.title}</span>
          <span className="row-detail">{row.detail || (hasChildren ? `${row.children.length} servicios` : '')}</span>
        </button>
        {hasChildren && (
          <button type="button" className="unfold" onClick={onToggle}
            aria-label={unfolded ? 'Ocultar servicios' : 'Ver servicios'} title={unfolded ? 'Ocultar servicios' : 'Ver servicios'}>
            {unfolded ? '▾' : '▸'}
          </button>
        )}
      </div>
      {unfolded && row.children.map((r) => <Row key={r.key} row={r} child />)}
    </>
  );
}

/**
 * Una fila por problema (una por servidor caído, desplegable en sus servicios); máx. 6 a la vista.
 * Las filas desplegadas las conoce el proceso principal, que dimensiona la ventana con ellas.
 */
export function Rows({ rows, unfolded, onToggle }: { rows: WidgetRow[]; unfolded: string[]; onToggle: (key: string) => void }) {
  return (
    <div className="rows">
      {rows.map((r) => <Row key={r.key} row={r} unfolded={unfolded.includes(r.key)} onToggle={() => onToggle(r.key)} />)}
    </div>
  );
}
