/**
 * Un color por cliente, siempre el mismo para el mismo cliente (sale de su
 * id), para reconocerlo de un vistazo en el tablero. Diez tonos que se
 * distinguen también por luminosidad, no solo por matiz.
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
];

export function clientColor(clientId: number): ClientColor {
  const i = Math.abs(Math.trunc(clientId)) % PALETTE.length;
  return PALETTE[i];
}
