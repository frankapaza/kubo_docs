import { BadRequestException } from '@nestjs/common';

export type TicketStatus =
  | 'NUEVO'
  | 'TRIAJE'
  | 'ASIGNADO'
  | 'EN_ATENCION'
  | 'ESPERA_CLIENTE'
  | 'DERIVADO'
  | 'RESUELTO'
  | 'CERRADO';

export const TICKET_STATUSES: TicketStatus[] = [
  'NUEVO',
  'TRIAJE',
  'ASIGNADO',
  'EN_ATENCION',
  'ESPERA_CLIENTE',
  'DERIVADO',
  'RESUELTO',
  'CERRADO',
];

/** Estados que cuentan como "abierto" en la bandeja, los KPI y el job de riesgo. */
export const OPEN_STATUSES: TicketStatus[] = [
  'NUEVO',
  'TRIAJE',
  'ASIGNADO',
  'EN_ATENCION',
  'ESPERA_CLIENTE',
  'DERIVADO',
];

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NUEVO: ['TRIAJE', 'ASIGNADO', 'CERRADO'],
  TRIAJE: ['ASIGNADO', 'CERRADO'],
  ASIGNADO: ['EN_ATENCION', 'DERIVADO', 'CERRADO'],
  EN_ATENCION: ['ESPERA_CLIENTE', 'DERIVADO', 'RESUELTO', 'CERRADO'],
  ESPERA_CLIENTE: ['EN_ATENCION', 'RESUELTO', 'CERRADO'],
  DERIVADO: ['EN_ATENCION', 'CERRADO'],
  RESUELTO: ['CERRADO', 'EN_ATENCION'],
  CERRADO: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (canTransition(from, to)) return;
  throw new BadRequestException({
    code: 'INVALID_TRANSITION',
    message: `No se puede pasar de «${from}» a «${to}».`,
  });
}

/** Cerrar sin haber resuelto es cancelar: el prototipo exige dejar constancia. */
export function isCancellation(from: TicketStatus, to: TicketStatus): boolean {
  return to === 'CERRADO' && from !== 'RESUELTO';
}

/** Reabrir un ticket ya resuelto. */
export function isReopen(from: TicketStatus, to: TicketStatus): boolean {
  return from === 'RESUELTO' && to === 'EN_ATENCION';
}

/**
 * Transiciones que no se aceptan sin `reason`.
 * Regla 03 del prototipo (derivar) y trazabilidad de cancelación y reapertura.
 */
export function requiresReason(from: TicketStatus, to: TicketStatus): boolean {
  return to === 'DERIVADO' || isCancellation(from, to) || isReopen(from, to);
}
