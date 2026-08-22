/**
 * Un correo tal y como lo entrega el buzón, ya reducido a lo que el resto del
 * recorrido necesita para decidir qué hacer con él.
 *
 * `authenticationResults` guarda **solo la más alta** de las cabeceras
 * `Authentication-Results` que puede traer un mensaje (una por cada salto que
 * lo autentica): quien la lea no tiene que saber que puede haber varias ni
 * decidir cuál importa, eso ya lo resolvió el adaptador que la produjo.
 */
export interface IncomingMessage {
  messageId: string;
  from: string;
  subject: string | null;
  sentAt: Date | null;
  textBody: string;
  headers: Record<string, string | undefined>;
  authenticationResults: string | null;
  attachmentNames: string[];
}

export const MAILBOX = Symbol('MAILBOX');

/**
 * El contrato con el buzón real, y nada más.
 *
 * Es **deliberadamente pequeño**: dos métodos, sin nada "por si acaso". Esa
 * pequeñez es la que permite probar el recorrido completo de un correo —desde
 * que llega hasta que crea o alimenta un ticket— con una lista de
 * `IncomingMessage` de ejemplo y un doble trivial de estas dos funciones, sin
 * red ni un servidor IMAP de verdad delante. Cualquier método añadido "por si
 * acaso" ata el servicio a los detalles del buzón concreto y esa prueba deja
 * de ser posible.
 */
export interface Mailbox {
  fetchUnprocessed(limit: number): Promise<IncomingMessage[]>;
  markProcessed(messageId: string): Promise<void>;
}
