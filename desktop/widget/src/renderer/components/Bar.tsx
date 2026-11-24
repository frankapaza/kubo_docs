import type { Corner } from '../../shared/types';
import type { WidgetModel } from '../../shared/widget-model';
import { TONE_COLORS } from '../palette';

const PINS: Array<[Corner, string, string]> = [
  ['top-left', '◸', 'Fijar arriba a la izquierda'],
  ['top-right', '◹', 'Fijar arriba a la derecha'],
  ['bottom-left', '◺', 'Fijar abajo a la izquierda'],
  ['bottom-right', '◿', 'Fijar abajo a la derecha'],
];

/** Barra de 40 px: se arrastra por ella; al soltar se acopla a la esquina más cercana. */
export function Bar({ model }: { model: WidgetModel }) {
  return (
    <div className="bar" title="Arrastra para mover; se fija en la esquina más cercana">
      <span className={`dot${model.tone === 'red' ? ' pulse' : ''}`} style={{ background: TONE_COLORS[model.tone].fg }} />
      <span className="headline">{model.headline}</span>
      <span className="tools">
        {PINS.map(([c, icon, label]) => (
          <button key={c} type="button" title={label} aria-label={label} onClick={() => window.kubo.setCorner(c)}>{icon}</button>
        ))}
        <button type="button" title="Abrir tablero" aria-label="Abrir tablero" onClick={() => window.kubo.openDashboard()}>↗</button>
      </span>
      <span className="time">{model.time}</span>
    </div>
  );
}
