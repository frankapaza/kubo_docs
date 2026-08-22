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
  /**
   * El remitente, **ya reducido a una dirección de correo desnuda** --
   * `ana@empresa.com`, nunca `"Ana Quispe" <ana@empresa.com>`. A quien
   * produce este valor (el adaptador: `ImapMailboxService.extractFromAddress`
   * para IMAP) le corresponde resolverlo con un analizador de direcciones
   * consciente de la gramática completa de RFC 5322 (comillas, comentarios,
   * grupos) -- nunca entregar la cabecera cruda para que otra capa la
   * desenvuelva con una expresión regular más abajo.
   *
   * **Contrato revisado en la ronda de correcciones 2 de la Task 8, y por
   * una razón de seguridad, no de estilo.** La versión original de este
   * contrato pedía la cabecera cruda y delegaba en `extractSenderAddress`
   * (`./domain/message-headers.ts`) desenvolverla en un único sitio del
   * recorrido. Eso funciona mientras el "nombre para mostrar" es lo único
   * que puede contener un `<...>` engañoso -- pero RFC 5322 también permite
   * que el **local-part** de la dirección real sea una `quoted-string` que
   * contenga, sin escapar, su propio `<direccion@dominio>`
   * (`"<jefe@kuboti.com>"@evil.com` es una dirección válida). Una expresión
   * regular no puede distinguir ese caso de un nombre para mostrar ambiguo:
   * las dos formas se ven idénticas en texto plano. Un analizador de
   * direcciones de verdad (el de `mailparser`, usado por
   * `ImapMailboxService`) sí las distingue, porque entiende la gramática
   * completa -- por eso la resolución tiene que ocurrir en el adaptador, con
   * ese analizador, y no reintentarse después con una aproximación más
   * pobre. Ver el docblock de `ImapMailboxService` (punto 2) para la
   * cadena completa de vectores que enseñó esto.
   *
   * **Ni siquiera así basta por sí solo.** Un `From` duplicado (dos
   * cabeceras `From:`) o un error genuino del propio analizador pueden
   * seguir dando una dirección de un dominio que no es el que de verdad
   * autenticó DMARC. La defensa que cierra esos casos no vive aquí ni en el
   * adaptador: es el cruce de dominios en `InboundEmailService.processOne`
   * (`extractAuthenticatedDomain` contra `domainOf(message.from)`), que no
   * depende de que esta extracción haya acertado.
   *
   * Cadena vacía si el adaptador no pudo resolver ninguna dirección directa
   * (un `From` en forma de grupo, sin miembro directo) -- nunca una
   * alternativa insegura como la re-serialización de nombre+dirección.
   * `isOwnMailbox` y cualquier búsqueda de usuario por correo comparan este
   * valor directamente, sin ningún paso intermedio.
   */
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
  /**
   * Deshace `markProcessed` para poder reencolar un correo que quedó
   * `ERROR` (Task 9, pantalla de correo entrante): **el reintento no
   * reprocesa, re-encola**. El correo sigue en el buzón -- `markProcessed`
   * solo pone una bandera, no borra ni mueve nada --, así que basta con
   * quitarla para que el lector de cada minuto (`InboundEmailService.drain`)
   * lo vuelva a leer por el camino de siempre, con una fila nueva.
   *
   * **Por qué recibe el `Message-ID` crudo y no un `mailboxRef`, a pesar de
   * ser "el espejo" de `markProcessed`.** `mailboxRef` es deliberadamente
   * efímero: nace en `fetchUnprocessed`, vive lo que dura una pasada de
   * `drain`, y **nunca se persiste** en `inbound_emails` (ver el comentario
   * de esa columna, que no existe). Un reintento se pide minutos, horas o
   * días después de que esa pasada terminó, así que para entonces no hay
   * ningún `mailboxRef` al que volver -- lo único que `inbound_emails` sí
   * guarda de forma durable, y que además coincide con lo que trae de verdad
   * la cabecera del mensaje, es `messageIdRaw`. Buscar por él en el buzón
   * (en vez de por un identificador propio del buzón) es exactamente la
   * comparación que `IncomingMessage.mailboxRef` advierte que **no** hay que
   * usar para marcar -- con dos límites aceptados, documentados donde se
   * implementa: un `Message-ID` no es único por protocolo (una copia oculta,
   * un reenvío, una lista de distribución pueden compartirlo) y un mensaje
   * sin cabecera `Message-ID` propia (identificador sintético, ver
   * `syntheticMessageId`) no se puede volver a encontrar por este camino.
   *
   * **Lanza si no pudo completar la operación**, a diferencia de
   * `markProcessed` (cuyo fallo es inofensivo: el correo se reprocesa solo y
   * se deduplica). Aquí sí importa que quien llama sepa si de verdad quedó
   * reencolado, porque de eso depende si es seguro renombrar la fila en la
   * base de datos (liberar la clave única de `message_id`) -- ver
   * `InboundEmailService.retry`.
   */
  markUnprocessed(messageIdRaw: string): Promise<void>;
}
