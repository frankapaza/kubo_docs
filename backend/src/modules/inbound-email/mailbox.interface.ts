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
  /**
   * El identificador **propio del buzón** para este mensaje concreto —un UID
   * de IMAP, el id de un mensaje de la API de Gmail, lo que sea que el
   * adaptador use para localizarlo de nuevo—, opaco para el resto del
   * recorrido: nadie más que el propio `Mailbox` le da significado.
   *
   * Es lo único que `markProcessed` acepta, y a propósito no es `messageId`.
   * La cabecera `Message-ID` es **de negocio** (correlaciona una respuesta con
   * su ticket) pero es opcional y puede llegar **duplicada** entre varios
   * correos (una copia oculta, un reenvío, una lista de distribución que la
   * conserva tal cual). Marcar por `messageId` arriesgaría marcar el mensaje
   * equivocado, o no tener nada que marcar si la cabecera faltaba; el correo
   * real seguiría entrando en cada pasada y se atascaría la cabecera del
   * lote. `mailboxRef` no tiene ese problema porque lo asigna el propio buzón,
   * no un remitente.
   */
  mailboxRef: string;
  /**
   * El `Message-ID` **crudo**, tal cual llegó en la cabecera del correo —sin
   * normalizar—. Puede no ser ASCII: el correo internacionalizado (RFC 6532)
   * amplía la gramática del identificador para admitir UTF-8, y es válido por
   * norma, no un caso corrupto (ver la migración 021, sección 1).
   *
   * Quien vaya a correlacionar este valor contra una columna de la base
   * (`inbound_emails.message_id`, `tickets.email_message_id`,
   * `ticket_events.sent_message_id` — las tres en ASCII) **no puede usarlo tal
   * cual**: debe pasarlo antes por `normalizeMessageId` (`./message-id.ts`).
   * Compararlo sin normalizar contra esas columnas no encuentra el duplicado
   * y rompe la idempotencia de la ingesta, que es lo único que impide un
   * ticket repetido tras un reinicio a medias.
   */
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
  /** Marca procesado por `mailboxRef` (ver su comentario en `IncomingMessage`), nunca por `messageId`. */
  markProcessed(mailboxRef: string): Promise<void>;
}
