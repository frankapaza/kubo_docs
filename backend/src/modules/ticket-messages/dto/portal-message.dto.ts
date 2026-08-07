/**
 * Lo que el portal de clientes ve del hilo de un ticket.
 *
 * Es una **lista blanca escrita a mano**, igual que `PortalTicketView`: no es
 * la entidad menos unas claves. La diferencia importa el día que
 * `ticket_messages` o `ticket_attachments` ganen una columna --un coste, una
 * marca de riesgo, el id de quien la tocó--, porque un `spread` la publicaría
 * sola y en el portal eso es gente de fuera de la empresa leyéndola.
 *
 * Fuera, y por qué:
 *
 * - **`visibility`.** Para el cliente no existen dos clases de mensaje: solo
 *   existen los públicos. Publicar el campo --aunque siempre valiera
 *   `PUBLICA`-- le contaría que hay otra clase, que es medio secreto ya.
 * - **`authorUserId`.** El identificador de un técnico de Kubo es plantilla
 *   interna, y con él se enumera. Lo que el cliente necesita saber es de qué
 *   lado viene el mensaje, no quién exactamente.
 * - **`ticketId`.** Ya lo puso él en la URL.
 * - **`storageKey`.** La clave del almacenamiento no sale de este servidor:
 *   con ella, cualquier fallo de contención en otro sitio se convierte en
 *   descarga directa saltándose el guard.
 * - **`messageId` del adjunto.** Cada adjunto viaja ya **dentro** de su
 *   mensaje, así que repetirlo solo sería otro identificador suelto.
 * - **Quién subió el adjunto**, por lo mismo que el autor interno.
 */

/**
 * De qué lado viene el mensaje: de la propia empresa del cliente o del equipo
 * de Kubo. Los mismos dos valores que `TicketActor['kind']`, que es lo que
 * decide las columnas al escribirlo, para que las dos puntas hablen igual.
 */
export type PortalMessageAuthor = 'CLIENT' | 'STAFF';

export interface PortalAttachmentView {
  id: number;
  filename: string;
  mimeType: string;
  /** Bytes reales del fichero guardado, no los que declaró quien lo subió. */
  size: number;
  createdAt: string;
}

export interface PortalMessageView {
  id: number;
  bodyMd: string;
  author: PortalMessageAuthor;
  createdAt: string;
  attachments: PortalAttachmentView[];
}

/**
 * Lo que se contesta a quien acaba de escribir en el hilo.
 *
 * Lleva el estado en que **queda el ticket** porque el mensaje de un cliente
 * puede reactivarlo (`ESPERA_CLIENTE` → `EN_ATENCION`, ver
 * `TicketMessagesService.post`), y esa es la única forma de que el portal lo
 * enseñe sin volver a preguntar por el ticket entero. Es el estado, y nada más:
 * el ticket que devuelve el servicio trae prioridad, vencimientos de SLA y
 * responsable, que el portal no publica.
 */
export interface PortalPostedMessageView {
  message: PortalMessageView;
  ticketStatus: string;
}
