import type { WorkItem } from '../../api/types';
import { PRIORITY_STYLES, dueDateStyle } from './workitem-ui';

export interface WorkItemCardProps {
  item: WorkItem;
  assigneeName: string;
  onOpen: (item: WorkItem) => void;
  /**
   * El arrastre nativo y el menú «Mover a…» accesible por teclado llegan en
   * la Tarea 10. El contrato se declara aquí para que WorkItemsBoardPage no
   * tenga que cambiar la forma de esta tarjeta otra vez; por ahora ningún
   * control de la tarjeta lo dispara.
   */
  onMove: (item: WorkItem) => void;
}

const DUE_DATE_FORMATTER = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' });

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return 'Sin fecha objetivo';
  return DUE_DATE_FORMATTER.format(new Date(`${dueDate}T00:00:00`));
}

/**
 * Tarjeta del tablero: código, título, prioridad, fecha objetivo (con su
 * color, nunca "vencida" si el ítem ya está cerrado o cancelado) y asignado.
 * Es un <article> con un <button> interno que abre el detalle — nunca un
 * <div onClick>.
 */
export default function WorkItemCard({ item, assigneeName, onOpen }: WorkItemCardProps) {
  const priorityStyle = PRIORITY_STYLES[item.priority];
  const due = dueDateStyle(item.dueDate, item.status);
  const label = item.code ?? `requerimiento #${item.id}`;

  return (
    <article
      style={{
        background: '#fff',
        border: '1px solid #e2e5e6',
        borderRadius: 8,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={`Abrir el detalle de ${label}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 4,
          border: 'none',
          background: 'none',
          padding: 0,
          margin: 0,
          textAlign: 'left',
          cursor: 'pointer',
          width: '100%',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6d7577' }}>
          {label}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#15191a', lineHeight: 1.3 }}>
          {item.title}
        </span>
      </button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 4,
            background: priorityStyle.bg,
            color: priorityStyle.fg,
          }}
        >
          {item.priority}
        </span>
        <span style={{ fontSize: 11, color: due.color, fontWeight: due.overdue ? 600 : 400 }}>
          {formatDueDate(item.dueDate)}
        </span>
      </div>

      <span style={{ fontSize: 11, color: '#6d7577' }}>{assigneeName}</span>
    </article>
  );
}
