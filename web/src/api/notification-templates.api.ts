import { api } from './client';

export type NotificationAudience = 'CLIENT' | 'TEAM';

/**
 * Proyección que expone `GET /notification-templates` (ver
 * `NotificationTemplatesController.list` / `NotificationTemplateView` en el
 * backend). `variables` viaja calculado por el propio backend con la misma
 * función (`variablesFor`) que usa la validación al guardar: esta pantalla no
 * lleva su propia copia de qué variable es de qué público a propósito, para
 * que nunca pueda divergir de lo que el guardado acepta.
 */
export interface NotificationTemplate {
  id: number;
  triggerKey: string;
  audience: NotificationAudience;
  subject: string;
  bodyMd: string;
  isActive: boolean;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  variables: string[];
}

/**
 * Refleja `UpdateNotificationTemplateDto` campo por campo: deliberadamente
 * sin `audience` (el backend nunca lo lee del cuerpo; el público de una
 * plantilla no se cambia por edición).
 */
export interface UpdateNotificationTemplateBody {
  subject?: string;
  bodyMd?: string;
  isActive?: boolean;
}

/**
 * Lo que devuelve tanto `preview` como el envío real: `html` no está saneado
 * (ver `email-compose.ts` en el backend), así que quien consuma esto SIEMPRE
 * tiene que renderizarlo aislado — un `iframe` en `sandbox` — y nunca con
 * `dangerouslySetInnerHTML` en el DOM del panel.
 */
export interface ComposedEmailPreview {
  subject: string;
  html: string;
  text: string;
}

export const notificationTemplatesApi = {
  /** Todas las plantillas, activas e inactivas, cliente y equipo por igual. */
  list: () => api.get<NotificationTemplate[]>('/notification-templates').then((r) => r.data),

  /** Requiere rol ADMIN en el backend (`@Roles('ADMIN')`). */
  update: (id: number, body: UpdateNotificationTemplateBody) =>
    api.patch<NotificationTemplate>(`/notification-templates/${id}`, body).then((r) => r.data),

  /**
   * Compone con datos de ejemplo la última versión GUARDADA de la plantilla
   * (el endpoint no acepta cuerpo: ver el comentario en el controlador). No
   * refleja ediciones sin guardar en el formulario.
   */
  preview: (id: number) =>
    api.post<ComposedEmailPreview>(`/notification-templates/${id}/preview`).then((r) => r.data),

  /**
   * Manda un correo de prueba al correo de quien hace la petición (lo decide
   * el backend a partir del token, nunca del cuerpo). Limitado a 3 por
   * minuto: un 429 trae en `message` el texto en español para mostrar tal
   * cual, ver `THROTTLED_MESSAGE` en el backend.
   */
  sendTest: (id: number) =>
    api.post<{ to: string }>(`/notification-templates/${id}/test`).then((r) => r.data),
};

/**
 * Solo para mostrar una etiqueta legible en la lista; nunca se usa para
 * decidir nada (esa lógica -- qué evento dispara qué plantilla -- vive
 * enteramente en `notification-rules.ts` del backend). Si algún día se
 * siembra una clave nueva y esta tabla no se actualiza, el único efecto es
 * que se muestra la clave cruda en vez de una frase; no rompe nada.
 */
export const TRIGGER_KEY_LABELS: Record<string, string> = {
  TICKET_CREATED: 'Ticket creado',
  TICKET_RESOLVED: 'Ticket resuelto',
  TICKET_CLOSED: 'Ticket cerrado',
  TICKET_REOPENED: 'Ticket reabierto',
  TICKET_WAITING_CLIENT: 'Ticket en espera del cliente',
  TICKET_CREATED_PORTAL: 'Ticket nuevo desde el portal',
  SLA_AT_RISK: 'SLA en riesgo',
};

export function triggerKeyLabel(triggerKey: string): string {
  return TRIGGER_KEY_LABELS[triggerKey] ?? triggerKey;
}

export const AUDIENCE_LABELS: Record<NotificationAudience, string> = {
  CLIENT: 'Clientes',
  TEAM: 'Equipo interno',
};
