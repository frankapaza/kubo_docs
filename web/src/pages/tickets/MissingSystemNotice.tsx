import { useState } from 'react';

import type { ClientSystem } from '../../api/types';

/**
 * Aviso del detalle de un ticket sin sistema cuyo cliente sí tiene sistemas:
 * sin él no se puede tomar, asignar, escalar, mover ni concluir (el backend
 * responde SISTEMA_REQUERIDO), y el conector MCP no lo ve. Se elige aquí mismo.
 */
export default function MissingSystemNotice({
  systems,
  busy,
  onAssign,
}: {
  systems: ClientSystem[];
  busy: boolean;
  onAssign: (systemId: number) => void;
}) {
  const active = systems.filter((s) => Number(s.isActive) === 1);
  const [choice, setChoice] = useState<number | ''>('');
  if (active.length === 0) return null;
  return (
    <div
      role="alert"
      style={{ border: '1px solid #f0d9a8', background: '#fff4e0', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#7a4a00' }}>
        Asigna el sistema para poder tomar, asignar o mover este ticket
      </div>
      <div style={{ fontSize: 12, color: '#7a4a00' }}>
        Sin sistema tampoco aparece en el conector de Claude (MCP) de ningún módulo.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select
          aria-label="Sistema del ticket"
          value={choice}
          onChange={(e) => setChoice(e.target.value ? Number(e.target.value) : '')}
          style={{ fontSize: 13, padding: '5px 8px', borderRadius: 6, border: '1px solid #d8dcdd', minWidth: 200 }}
        >
          <option value="">Elige el sistema…</option>
          {active.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || choice === ''}
          onClick={() => choice !== '' && onAssign(choice)}
          style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: 'none', background: '#a35c00', color: '#fff', cursor: busy || choice === '' ? 'default' : 'pointer', opacity: busy || choice === '' ? 0.6 : 1 }}
        >
          Asignar sistema
        </button>
      </div>
    </div>
  );
}
