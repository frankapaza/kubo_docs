import { useEffect, useRef, useState } from 'react';

import type { WorkItem, WorkItemStatus } from '../../api/types';
import { ALL_STATUSES, PRIORITY_STYLES, STATUS_LABELS, dueDateStyle } from './workitem-ui';

export interface WorkItemCardProps {
  item: WorkItem;
  assigneeName: string;
  onOpen: (item: WorkItem) => void;
  /**
   * Disparado por el menú «Mover a…». El índice de destino (al final de la
   * columna) lo calcula la página, que es quien conoce el largo de cada
   * columna.
   */
  onMove: (item: WorkItem, toStatus: WorkItemStatus) => void;
  /** Arrastre nativo: la tarjeta solo avisa: la página lleva el estado. */
  onDragStart: (item: WorkItem) => void;
  onDragEnd: () => void;
  /** true mientras esta tarjeta es la que se está arrastrando. */
  dragging: boolean;
}

const DUE_DATE_FORMATTER = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' });

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return 'Sin fecha objetivo';
  return DUE_DATE_FORMATTER.format(new Date(`${dueDate}T00:00:00`));
}

/**
 * Botón «Mover a…»: alternativa por teclado al arrastre nativo, que no
 * funciona sin ratón. Lista los seis estados salvo el actual; elegir uno
 * mueve la tarjeta al final de esa columna. Reordenar dentro de una columna
 * por teclado queda fuera de R1 — este menú solo cambia de columna, que es
 * lo que importa para no quedar bloqueado sin ratón.
 */
function MoveMenu({
  item,
  onMove,
}: {
  item: WorkItem;
  onMove: (item: WorkItem, toStatus: WorkItemStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = item.code ?? `requerimiento #${item.id}`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);

  const destinations = ALL_STATUSES.filter((s) => s !== item.status);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Mover ${label} a otra columna`}
        onClick={() => setOpen((v) => !v)}
        style={{
          fontSize: 11, fontWeight: 500, padding: '5px 9px', borderRadius: 6,
          border: '1px solid #dfe3e4', background: '#fff', color: '#3a4041', cursor: 'pointer',
        }}
      >
        Mover a…
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Destinos para ${label}`}
          style={{
            position: 'absolute', zIndex: 20, top: '100%', right: 0, marginTop: 4,
            background: '#fff', border: '1px solid #dfe3e4', borderRadius: 8,
            boxShadow: '0 6px 18px rgba(0,0,0,0.16)', minWidth: 160,
            display: 'flex', flexDirection: 'column', padding: 4,
          }}
        >
          {destinations.map((status) => (
            <button
              key={status}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onMove(item, status);
              }}
              style={{
                fontSize: 12, textAlign: 'left', padding: '7px 10px', borderRadius: 5,
                border: 'none', background: 'none', cursor: 'pointer', color: '#15191a',
              }}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Tarjeta del tablero: código, título, prioridad, fecha objetivo (con su
 * color, nunca "vencida" si el ítem ya está cerrado o cancelado), asignado,
 * y los dos caminos para moverla de columna: arrastre nativo (draggable +
 * onDragStart/onDragEnd; la página decide dónde cae) y el menú «Mover a…»
 * accesible por teclado. Es un <article> con <button>s internos — nunca un
 * <div onClick>.
 */
export default function WorkItemCard({
  item, assigneeName, onOpen, onMove, onDragStart, onDragEnd, dragging,
}: WorkItemCardProps) {
  const priorityStyle = PRIORITY_STYLES[item.priority];
  const due = dueDateStyle(item.dueDate, item.status);
  const label = item.code ?? `requerimiento #${item.id}`;

  return (
    <article
      data-card-id={item.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(item.id));
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(item);
      }}
      onDragEnd={onDragEnd}
      style={{
        background: '#fff',
        border: '1px solid #e2e5e6',
        borderRadius: 8,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: dragging ? 0.45 : 1,
        cursor: 'grab',
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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#6d7577' }}>{assigneeName}</span>
        <MoveMenu item={item} onMove={onMove} />
      </div>
    </article>
  );
}
