import { api } from './client';

/**
 * Espejo de `InboundEmailOutcome`
 * (`backend/src/modules/inbound-email/entities/inbound-email.entity.ts`).
 * `DESCARTADO_SIN_CONTENIDO` y `ERROR` son los únicos dos que la migración
 * 022 y la Task 9 respectivamente añadieron después de la lista original;
 * si el backend añade uno nuevo sin que esta lista se actualice, el filtro
 * seguiría funcionando igual (el backend valida, no este tipo) pero el
 * selector no lo ofrecería como opción.
 */
export type InboundEmailOutcome =
  | 'TICKET_CREADO'
  | 'MENSAJE_ANADIDO'
  | 'DESCARTADO_NO_AUTENTICADO'
  | 'DESCARTADO_AUTOMATICO'
  | 'DESCARTADO_PROPIO'
  | 'DESCARTADO_DUPLICADO'
  | 'REMITENTE_DESCONOCIDO'
  | 'DESCARTADO_POR_TOPE'
  | 'DESCARTADO_SIN_CONTENIDO'
  | 'ERROR';

export const INBOUND_EMAIL_OUTCOMES: InboundEmailOutcome[] = [
  'TICKET_CREADO',
  'MENSAJE_ANADIDO',
  'DESCARTADO_NO_AUTENTICADO',
  'DESCARTADO_AUTOMATICO',
  'DESCARTADO_PROPIO',
  'DESCARTADO_DUPLICADO',
  'REMITENTE_DESCONOCIDO',
  'DESCARTADO_POR_TOPE',
  'DESCARTADO_SIN_CONTENIDO',
  'ERROR',
];

export const INBOUND_EMAIL_OUTCOME_LABELS: Record<InboundEmailOutcome, string> = {
  TICKET_CREADO: 'Ticket creado',
  MENSAJE_ANADIDO: 'Mensaje añadido a un hilo',
  DESCARTADO_NO_AUTENTICADO: 'Descartado: no autenticado',
  DESCARTADO_AUTOMATICO: 'Descartado: correo automático',
  DESCARTADO_PROPIO: 'Descartado: era nuestro propio acuse',
  DESCARTADO_DUPLICADO: 'Descartado: Message-ID duplicado',
  REMITENTE_DESCONOCIDO: 'Remitente no registrado',
  DESCARTADO_POR_TOPE: 'Descartado: tope alcanzado',
  DESCARTADO_SIN_CONTENIDO: 'Descartado: sin contenido que publicar',
  ERROR: 'Error',
};

/**
 * Proyección que expone `GET /inbound-emails` (ver
 * `backend/src/modules/inbound-email/inbound-email.controller.ts:toInboundEmailListItem`).
 *
 * Las dos etiquetas de fecha (`sentAtLabel`, `receivedAtLabel`) llegan **ya
 * formateadas por el backend, en hora de Perú** -- este componente no debe
 * volver a formatear `sentAt`/`receivedAt` porque no existen como tales aquí:
 * a propósito no se piden como ISO. Este proyecto lleva cinco fallos de zona
 * horaria por formatear en el navegador (que no corre en hora de Lima) en vez
 * de en el backend; no se repite un sexto en esta pantalla.
 */
export interface InboundEmailListItem {
  id: number;
  messageIdRaw: string | null;
  fromAddress: string;
  subject: string | null;
  sentAtLabel: string | null;
  receivedAtLabel: string;
  outcome: InboundEmailOutcome;
  reason: string | null;
  ticketId: number | null;
  attachmentCount: number;
  attachmentNames: string[] | null;
  retryable: boolean;
}

export const inboundEmailsApi = {
  /** Sin `outcome`, trae todo (hasta el tope de 500 del backend); con él, filtra por ese resultado. */
  list: (outcome?: InboundEmailOutcome) =>
    api
      .get<InboundEmailListItem[]>('/inbound-emails', { params: outcome ? { outcome } : undefined })
      .then((r) => r.data),

  /**
   * Reintenta una fila en `ERROR`: la re-encola (no la reprocesa aquí mismo)
   * y devuelve la propia fila actualizada -- todavía en `ERROR`, con el
   * motivo ampliado -- para que la pantalla pueda mostrar de inmediato que
   * el reencolado se aceptó. El resultado del reproceso en sí (ticket creado,
   * o un error nuevo) aparece más tarde, como una fila nueva, en el próximo
   * refresco de la lista.
   */
  retry: (id: number) =>
    api.post<InboundEmailListItem>(`/inbound-emails/${id}/retry`).then((r) => r.data),
};
