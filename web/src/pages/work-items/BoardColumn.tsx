import { Fragment } from 'react';
import type { DragEvent } from 'react';

import type { WorkItem, WorkItemStatus } from '../../api/types';
import WorkItemCard from './WorkItemCard';

export interface DropTarget {
  status: WorkItemStatus;
  index: number;
}

export interface BoardColumnProps {
  status: WorkItemStatus;
  label: string;
  items: WorkItem[];
  loading: boolean;
  assigneeLabel: (item: WorkItem) => string;
  onOpen: (item: WorkItem) => void;
  onMove: (item: WorkItem, toStatus: WorkItemStatus) => void;
  draggingId: number | null;
  dropTarget: DropTarget | null;
  onDragStartCard: (item: WorkItem) => void;
  onDragEndCard: () => void;
  onColumnDragOver: (e: DragEvent<HTMLElement>, status: WorkItemStatus) => void;
  onColumnDragLeave: (e: DragEvent<HTMLElement>, status: WorkItemStatus) => void;
  onColumnDrop: (e: DragEvent<HTMLElement>, status: WorkItemStatus) => void;
  minHeight?: number;
}

const DROP_INDICATOR = (
  <div aria-hidden="true" style={{ height: 3, borderRadius: 2, background: '#15191a', margin: '0 2px' }} />
);

/**
 * Una columna del tablero (o una de las dos bandejas de la franja fuera de
 * flujo): además de listar tarjetas, es zona de destino del arrastre nativo
 * — `onDragOver` con `preventDefault()` para admitir el drop, y un
 * indicador visual (barra) en la posición de inserción calculada.
 *
 * El cálculo del índice de destino (`computeDropIndex`) y todo el estado de
 * arrastre viven en WorkItemsBoardPage, que es quien conoce el tablero
 * completo; esta columna solo reenvía los eventos nativos y pinta lo que la
 * página le indica.
 */
export default function BoardColumn({
  status, label, items, loading, assigneeLabel, onOpen, onMove, draggingId, dropTarget,
  onDragStartCard, onDragEndCard, onColumnDragOver, onColumnDragLeave, onColumnDrop, minHeight,
}: BoardColumnProps) {
  return (
    <section
      aria-label={`Columna ${label}`}
      onDragOver={(e) => onColumnDragOver(e, status)}
      onDragLeave={(e) => onColumnDragLeave(e, status)}
      onDrop={(e) => onColumnDrop(e, status)}
      style={{
        background: '#f5f6f6', border: '1px solid #e2e5e6', borderRadius: 10, padding: 10,
        display: 'flex', flexDirection: 'column', gap: 8, minHeight: minHeight ?? 220,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#15191a' }}>{label}</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6d7577' }}>
          {items.length}
        </span>
      </div>
      {!loading && items.length === 0 && (
        <div style={{ fontSize: 12, color: '#9aa1a2', padding: '8px 4px' }}>Sin ítems</div>
      )}
      {items.map((item, idx) => (
        <Fragment key={item.id}>
          {dropTarget?.status === status && dropTarget.index === idx && DROP_INDICATOR}
          <WorkItemCard
            item={item}
            assigneeName={assigneeLabel(item)}
            onOpen={onOpen}
            onMove={onMove}
            dragging={draggingId === item.id}
            onDragStart={onDragStartCard}
            onDragEnd={onDragEndCard}
          />
        </Fragment>
      ))}
      {dropTarget?.status === status && dropTarget.index === items.length && DROP_INDICATOR}
    </section>
  );
}
