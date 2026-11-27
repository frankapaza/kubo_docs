/**
 * Un color por cliente, siempre el mismo para el mismo cliente (sale de su
 * id), para reconocerlo de un vistazo en tickets y requerimientos. Dieciséis
 * tonos: con ids consecutivos, hasta 16 clientes no repiten color.
 */
export interface ClientColor {
  /** Franja y punto. */
  solid: string;
  /** Fondo de la etiqueta. */
  soft: string;
  /** Texto sobre `soft` (contraste ≥ 4.5:1). */
  ink: string;
}

const PALETTE: ClientColor[] = [
  { solid: '#2F6FDB', soft: '#E3ECFB', ink: '#1D4E9E' },
  { solid: '#E07B1A', soft: '#FCEBD9', ink: '#8A4508' },
  { solid: '#8B5CF6', soft: '#EEE7FE', ink: '#5B33B8' },
  { solid: '#D63A7A', soft: '#FBE4EE', ink: '#9B1F52' },
  { solid: '#0F9D8A', soft: '#D9F3EF', ink: '#0B6559' },
  { solid: '#A16207', soft: '#F8EDD3', ink: '#744604' },
  { solid: '#4B5563', soft: '#E9ECEF', ink: '#374151' },
  { solid: '#3F8F3A', soft: '#E2F1E0', ink: '#2C6528' },
  { solid: '#C2413A', soft: '#F9E2E0', ink: '#8E2A24' },
  { solid: '#0E7490', soft: '#D8EEF4', ink: '#0B5568' },
  { solid: '#7C3AED', soft: '#EDE5FD', ink: '#5B21B6' },
  { solid: '#CA8A04', soft: '#FBF1CF', ink: '#78500A' },
  { solid: '#BE185D', soft: '#FADCE9', ink: '#8A1145' },
  { solid: '#15803D', soft: '#DCF2E3', ink: '#14532D' },
  { solid: '#1E3A8A', soft: '#DFE5F5', ink: '#1E3A8A' },
  { solid: '#9A3412', soft: '#F6E1D6', ink: '#7C2D12' },
];

/** Punto + nombre del cliente con su color. */
export function ClientTag({ clientId, name }: { clientId: number; name: string }) {
  const c = clientColor(clientId);
  return (
    <span
      title={name}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', fontSize: 11, fontWeight: 600,
        padding: '2px 8px', borderRadius: 999, background: c.soft, color: c.ink,
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: c.solid, flex: 'none' }} />
      {name}
    </span>
  );
}

export function clientColor(clientId: number): ClientColor {
  const i = Math.abs(Math.trunc(clientId)) % PALETTE.length;
  return PALETTE[i];
}
