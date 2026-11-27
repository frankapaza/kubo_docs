import { useEffect, useState } from 'react';
import type { HealthRows } from '../shared/health';
import type { LoginSummary } from '../shared/login-summary';
import type { WidgetModel } from '../shared/widget-model';
import { Bar } from './components/Bar';
import { Health } from './components/Health';
import { Rows } from './components/Rows';
import { Summary } from './components/Summary';
import { TONE_COLORS } from './palette';

const INITIAL: WidgetModel = { tone: 'grey', headline: 'Conectando con el motor…', time: '', rows: [], expanded: false };

export function App() {
  const [model, setModel] = useState<WidgetModel>(INITIAL);
  const [summary, setSummary] = useState<LoginSummary | null>(null);
  const [health, setHealth] = useState<HealthRows | null>(null);

  const [unfolded, setUnfolded] = useState<string[]>([]);

  useEffect(() => {
    const offs = [window.kubo.onModel(setModel), window.kubo.onSummary(setSummary), window.kubo.onHealth(setHealth)];
    return () => offs.forEach((off) => off());
  }, []);

  // Las filas de servidor que desaparecen del modelo dejan de contar como desplegadas.
  const known = model.rows.filter((r) => r.children.length > 0).map((r) => r.key);
  const open = unfolded.filter((k) => known.includes(k));
  const openKey = open.join('|');
  useEffect(() => { window.kubo.setUnfolded(open); }, [openKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string): void => {
    setUnfolded(open.includes(key) ? open.filter((k) => k !== key) : [...open, key]);
  };

  return (
    <div className={`widget tone-${model.tone}`} style={{ borderColor: TONE_COLORS[model.tone].fg }}>
      <Bar model={model} />
      {summary && <Summary summary={summary} />}
      {health && <Health rows={health} />}
      {model.expanded && <Rows rows={model.rows} unfolded={open} onToggle={toggle} />}
    </div>
  );
}
