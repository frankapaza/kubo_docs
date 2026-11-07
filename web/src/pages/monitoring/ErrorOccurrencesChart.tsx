interface Props {
  daily: Array<{ day: string; count: number }>;
}

const W = 720;
const H = 120;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;

/**
 * Barras de las ocurrencias de los últimos 30 días, a mano en SVG (sin
 * librerías). El servidor ya rellena con ceros los días sin ocurrencias, así
 * que la serie es continua y cada barra es un día.
 */
export default function ErrorOccurrencesChart({ daily }: Props) {
  if (daily.length === 0) return null;
  const max = Math.max(1, ...daily.map((d) => d.count));
  const slot = W / daily.length;
  const barW = Math.max(2, slot - 3);
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const total = daily.reduce((s, d) => s + d.count, 0);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Ocurrencias por día en los últimos ${daily.length} días: ${total} en total, máximo ${max} en un día`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <line x1={0} x2={W} y1={H - PAD_BOTTOM} y2={H - PAD_BOTTOM} stroke="#dfe3e4" />
      <text x={0} y={10} fontSize={10} fill="#6d7577">{max}</text>
      {daily.map((d, i) => {
        const h = d.count === 0 ? 0 : Math.max(2, (d.count / max) * plotH);
        const x = i * slot + (slot - barW) / 2;
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${d.count}`}</title>
            {/* Barra de fondo con altura completa: el área de pasar el cursor de un día en cero. */}
            <rect x={i * slot} y={PAD_TOP} width={slot} height={plotH} fill="transparent" />
            <rect x={x} y={H - PAD_BOTTOM - h} width={barW} height={h} rx={1.5} fill="#b3261e" />
          </g>
        );
      })}
      <text x={0} y={H - 4} fontSize={10} fill="#6d7577">{daily[0].day.slice(5)}</text>
      <text x={W} y={H - 4} fontSize={10} fill="#6d7577" textAnchor="end">{daily[daily.length - 1].day.slice(5)}</text>
    </svg>
  );
}
