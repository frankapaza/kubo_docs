import { useQuery } from '@tanstack/react-query';

import { clientSystemsApi } from '../../api/tickets.api';

interface Props {
  id: string;
  clientId: number | null;
  value: number | null;
  onChange: (clientSystemId: number | null) => void;
  disabled?: boolean;
}

/**
 * El sistema (asignación cliente-sistema) de un requerimiento. Es lo que hace
 * que Claude lo vea desde el repo de ese sistema: sin sistema, ningún repo lo ve.
 */
export default function ClientSystemSelect({ id, clientId, value, onChange, disabled }: Props) {
  const systems = useQuery({
    queryKey: ['client-systems', clientId],
    queryFn: () => clientSystemsApi.list(clientId!),
    enabled: !!clientId,
  });
  const options = (systems.data ?? []).filter((s) => s.isActive || s.id === value);

  return (
    <label htmlFor={id} style={{ display: 'block' }}>
      <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Sistema</span>
      <select
        id={id}
        value={value ?? ''}
        disabled={disabled || !clientId}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        title="Claude solo ve los requerimientos que tienen sistema."
        style={{ fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6, width: '100%', boxSizing: 'border-box' }}
      >
        <option value="">{clientId ? 'Sin sistema' : 'Elige primero el cliente'}</option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </label>
  );
}
