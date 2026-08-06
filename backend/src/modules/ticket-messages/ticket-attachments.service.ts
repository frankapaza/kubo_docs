import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';

import {
  AllowedMimeType,
  AttachmentCandidate,
  MAX_TICKET_BYTES,
  assertAcceptable,
} from './domain/attachment-rules';
import { TicketAttachment } from './entities/ticket-attachment.entity';
import { TicketMessage } from './entities/ticket-message.entity';
import { TicketMessagesRepository } from './ticket-messages.repository';
import {
  ClientScope,
  Id,
  TicketMessageActor,
  loadVisibleTicketOrFail,
  resolveScope,
  ticketIsVisible,
} from './actor-scope';
import { sameId } from '../../common/ids';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketsRepository } from '../tickets/tickets.repository';
import { IStorageService, STORAGE_SERVICE } from '../audio/interfaces/storage.interface';

/**
 * Lo que un adjunto le deja a quien lo va a servir. `mimeType` es el
 * **detectado** por firma de bytes en la subida, nunca el que declaró quien la
 * hizo: es lo que el controlador pone en `Content-Type` al forzar la descarga
 * (`Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`), que
 * es la segunda barrera del diseño y la única que cubre los polígotos que la
 * detección por cabecera no ve. Servir aquí el tipo declarado sería devolverle
 * al atacante el control de cómo interpreta el navegador su propio archivo.
 *
 * `filename` viene ya saneado de la subida (`sanitizeFilename`): quien escriba
 * la cabecera `Content-Disposition` puede ponerlo tal cual sin volver a pensar.
 */
export interface AttachmentDownload {
  stream: NodeJS.ReadableStream;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * Lo que de un adjunto se puede enseñar. **Proyección campo por campo y sin
 * `spread`**, que es lo que la regla 4 del diseño pide para todo lo que ve un
 * cliente: devolver la entidad publicaría la clave del almacenamiento --con la
 * que un fallo de contención en cualquier otro sitio se convierte en descarga
 * directa--, los identificadores de quien subió, y de regalo cualquier columna
 * que se añada mañana a la tabla. Una lista negra sobre un `spread` se rompe
 * sola la próxima vez que alguien toque la entidad; esta se rompe en
 * compilación.
 */
export interface AttachmentSummary {
  id: number;
  messageId: number | null;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: Date;
}

/**
 * El cuerpo del 404 de un adjunto. **Uno solo para los cuatro caminos**: que no
 * exista, que su ticket no exista, que el ticket sea de otra empresa, o que
 * cuelgue de una nota interna. Cualquier diferencia entre ellos --el código, el
 * texto, incluso el estado-- deja distinguir lo que existe de lo que no, que es
 * justo lo que el 404 (en vez de un 403) viene a impedir: spec §4, reglas 2 y 4.
 */
const ATTACHMENT_NOT_FOUND = { code: 'NOT_FOUND', message: 'Adjunto no encontrado' } as const;

/** Mismo criterio para el mensaje del que se quiere colgar un adjunto. */
const MESSAGE_NOT_FOUND = { code: 'NOT_FOUND', message: 'Mensaje no encontrado' } as const;

/** Lo que se le contesta a quien no pudo llegar a guardar. Nunca lleva detalles del fallo. */
const NO_SE_PUDO_GUARDAR = {
  code: 'INTERNAL',
  message: 'No se pudo guardar el archivo adjunto.',
} as const;

/**
 * Extensión de cada tipo aceptado, para la clave que genera el servidor.
 *
 * Es un `Record` sobre `AllowedMimeType` -- exhaustivo en compilación -- y se
 * indexa **solo** con el tipo que devolvió `assertAcceptable`, es decir el
 * detectado por los bytes. La extensión del nombre que subió el cliente no
 * entra aquí ni en ningún otro sitio: `factura.png.exe` con bytes de PDF acaba
 * en `.pdf`. Es cosmética (nada del sistema decide por la extensión), pero un
 * directorio de subidas donde `file(1)` y el nombre coinciden es un directorio
 * que se puede auditar.
 */
const EXTENSIONS: Record<AllowedMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

/** Los megabytes de un tope, para el texto de un mensaje. Los dos topes son enteros de MB. */
const enMegabytes = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Largo máximo del nombre, el mismo `VARCHAR(255)` de la columna `filename`.
 *
 * Sin esta cota, un nombre de 300 caracteres --que un cliente elige libremente--
 * se escribía en disco, MySQL rechazaba el `INSERT` en modo estricto, se
 * compensaba con un borrado y salía un **500** por algo que es un 400. Con una
 * escritura y un borrado de disco por intento, es una forma barata de hacer
 * trabajar al disco en bucle; y un 500 en un caso que el usuario puede provocar
 * a voluntad tapa los 500 de verdad en el log.
 */
const MAX_FILENAME_LENGTH = 255;

/**
 * Lo que no puede aparecer en un nombre de archivo:
 *
 * - **Caracteres de control** (`\x00-\x1F`, `\x7F`), saltos de línea incluidos.
 *   Este nombre acaba en la cabecera `Content-Disposition` de la descarga, y un
 *   `\r\n` ahí es inyección de cabecera.
 * - **Comillas, punto y coma y dos puntos**, que son la sintaxis de esa misma
 *   cabecera: `attachment; filename="…"`. Un nombre con comillas cierra el
 *   parámetro y abre otro.
 * - **Separadores y comodines de ruta** (`/ \ * ? < > |`). El nombre no toca el
 *   sistema de ficheros --la clave la genera el servidor--, pero tampoco tiene
 *   por qué parecer una ruta cuando alguien lo copie a una.
 */
const CARACTERES_PROHIBIDOS = /[\u0000-\u001f\u007f"'`\\\/:;*?<>|]/g;

/** Rótulo para un nombre que, una vez saneado, no dice nada. */
const NOMBRE_POR_OMISION = 'archivo';

/**
 * El nombre tal y como se puede guardar y, después, escribir en una cabecera.
 *
 * «Sanearlo para pintarlo es cosa de quien lo pinta» vale para HTML, donde el
 * escape depende del contexto; no vale para una cabecera HTTP, donde el
 * carácter peligroso es siempre el mismo y quien la escribe está a dos tareas
 * de distancia. Aquí se despoja una vez, y lo que sale de este servicio ya se
 * puede poner en una cabecera sin pensar.
 *
 * Sustituye por `_` en vez de borrar para que no se peguen dos tramos que
 * estaban separados, y recorta puntos y espacios de los extremos: un nombre que
 * empiece por punto se esconde en un `ls`, y uno que acabe en punto o espacio no
 * se puede crear en Windows si alguien lo guarda tal cual.
 */
function sanitizeFilename(raw: string): string {
  const limpio = (raw ?? '')
    .replace(CARACTERES_PROHIBIDOS, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');

  return limpio.length > 0 ? limpio : NOMBRE_POR_OMISION;
}

/**
 * Sube, lista y sirve los adjuntos de un ticket.
 *
 * Es la primera vez que gente de fuera de la empresa escribe archivos en este
 * servidor y, con la lista corta de tipos, **se decidió no poner antivirus**
 * (spec §3). Las barreras que hay son las de aquí y las del controlador de
 * descarga; no hay una tercera capa detrás corrigiendo lo que estas dejen
 * pasar. Las cinco reglas del diseño (§4) se cumplen así:
 *
 * 1. **La clave la genera el servidor** (`storageKeyFor`). El nombre que manda
 *    quien sube se guarda como dato para mostrarlo y no participa en la clave.
 * 2. **Se valida antes de escribir** (`assertAcceptable`, por los bytes). Un
 *    archivo rechazado nunca llega a `IStorageService.save`.
 * 3. **El tipo que se devuelve al descargar es el detectado**, para que el
 *    controlador fuerce la descarga con él.
 * 4. **La descarga comprueba la empresa del token**, y lo ajeno da el mismo 404
 *    que lo inexistente.
 * 5. **Un adjunto hereda la visibilidad de su mensaje**: el de una nota interna
 *    no se descarga ni se lista desde el portal.
 */
@Injectable()
export class TicketAttachmentsService {
  private readonly logger = new Logger(TicketAttachmentsService.name);

  constructor(
    private readonly tickets: TicketsRepository,
    private readonly messages: TicketMessagesRepository,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  /**
   * Guarda un archivo colgado de un mensaje del ticket.
   *
   * **`messageId` es obligatorio**, y esa es la única forma de que la regla 5
   * no tenga excepciones. Un adjunto sin mensaje no hereda ninguna visibilidad:
   * `listAttachments` lo deja pasar al portal **siempre** (`att.message_id IS
   * NULL OR …`), porque esa rama se escribió cuando lo único que podía crear
   * una fila así era el alta del ticket -- premisa que dejó de ser cierta el día
   * que existió este método. Con `null` permitido, un técnico que subiera el
   * volcado de logs «al ticket» en vez de a una nota interna se lo estaría
   * publicando al cliente, sin ningún aviso y sin poder retirarlo. Si hace falta
   * adjuntar al crear el ticket, se crea el ticket **con su primer mensaje** y el
   * archivo cuelga de ahí: la descripción de un ticket *es* su primer mensaje.
   *
   * **El orden importa y es este**, y no por casualidad:
   *
   * 1. Se reparte el actor y su ámbito. Un `kind` desconocido o un cliente sin
   *    empresa no llegan ni a consultar.
   * 2. Se comprueba **de quién es el ticket**, y de qué mensaje se cuelga.
   *    Autorización antes que nada: sobre un recurso que no es tuyo no se
   *    procesa tu entrada.
   * 3. Se **acota y despoja el nombre**. Antes de decidir nada más, porque un
   *    nombre que la columna no admite tiene que ser un rechazo limpio y no un
   *    `INSERT` fallido con una escritura y un borrado de disco por intento.
   * 4. Se **valida el archivo por sus bytes**. Esto va antes de tocar el disco:
   *    un archivo rechazado no llega a escribirse, que es la única forma de que
   *    la lista corta de tipos signifique algo sin antivirus detrás.
   * 5. Se comprueba el **presupuesto del ticket**, y solo si quien sube es un
   *    cliente (`MAX_TICKET_BYTES` no aplica al equipo).
   * 6. Se escribe el archivo y **después** se inserta la fila.
   *
   * **Por qué el disco primero y la fila después.** No hay transacción que
   * abarque las dos cosas, así que uno de los dos huecos va a existir; se elige
   * el que menos duele. Una fila sin archivo es un adjunto **visible y roto**:
   * aparece en el hilo, cuenta contra el presupuesto del ticket, y al
   * descargarlo revienta con un `ENOENT` que además llega como 500 a un
   * cliente. Un archivo sin fila es basura **invisible**: no lo referencia
   * nadie, no se puede descargar, no cuenta para nada, y solo cuesta disco
   * hasta que se barra. Además el hueco es más estrecho en este orden, porque
   * el `INSERT` sí se puede compensar (borrando el archivo) mientras que la
   * escritura en disco no se puede "des-hacer" a tiempo si la fila ya está
   * escrita y alguien la lee.
   *
   * **El borrado de compensación también puede fallar** (permisos, disco
   * desmontado, S3 el día de mañana). En ese caso no se reintenta ni se
   * enmascara: se registra con la clave concreta -- que es lo que hace falta
   * para barrerlo después -- y se devuelve igualmente el error de la subida.
   * Un fallo al limpiar la basura nunca puede convertirse en la respuesta que
   * ve quien subió, ni tapar el fallo real.
   *
   * **La carrera del presupuesto** queda documentada y aceptada: dos subidas
   * simultáneas del mismo cliente pueden pasar las dos por el punto 5 y dejar
   * el ticket unos megabytes por encima del tope. Cerrarla exigiría bloquear
   * las filas del ticket durante toda la escritura en disco; el tope existe
   * para acotar el crecimiento, no para ser exacto al byte, y la siguiente
   * subida ya se corta.
   */
  async upload(
    actor: TicketMessageActor,
    ticketId: Id,
    messageId: Id,
    file: AttachmentCandidate,
  ): Promise<AttachmentSummary> {
    const { ids: uploader, scope } = resolveScope(actor, 'del adjunto');

    const ticket = await loadVisibleTicketOrFail(this.tickets, ticketId, scope);

    // Mismo criterio que el hilo (`TicketMessagesService.post`): un ticket
    // cerrado es evidencia cerrada y no tiene transición de salida, así que un
    // archivo colgado ahí no lo lee ya ningún flujo de trabajo.
    if (ticket.status === 'CERRADO') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Un ticket cerrado no admite adjuntos nuevos.',
      });
    }

    if (messageId === null || messageId === undefined || messageId === '') {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Un archivo adjunto tiene que colgar de un mensaje del ticket.',
      });
    }
    const message = await this.loadAttachableMessage(ticket, messageId, scope);

    // El nombre, acotado y despojado **antes** de decidir nada más: sin cota,
    // un nombre más largo que la columna se escribía en disco para que el
    // `INSERT` lo rechazara después.
    const filename = this.assertUsableFilename(file.filename);

    // La aduana. Por los bytes, y **antes** de escribir nada.
    const accepted = assertAcceptable({ ...file, filename });

    if (scope.restricted) await this.assertClientBudget(ticket.id, accepted.size);

    const storageKey = this.storageKeyFor(ticket.id, accepted.mimeType);
    await this.writeOrFail(file.buffer, storageKey, accepted.mimeType);

    let fila: TicketAttachment;
    try {
      fila = await this.messages.createAttachment({
        ticketId: ticket.id,
        messageId: message.id,
        // El nombre ya saneado: nunca toca el sistema de ficheros --la clave la
        // genera el servidor-- pero sí acaba en la cabecera `Content-Disposition`
        // de la descarga, y ahí un salto de línea es inyección de cabecera.
        filename: accepted.originalName,
        storageKey,
        mimeType: accepted.mimeType,
        sizeBytes: accepted.size,
        uploadedByUserId: uploader.userId,
        uploadedByClientUserId: uploader.clientUserId,
      });
    } catch (cause) {
      await this.discardOrphan(storageKey, cause);
      throw new InternalServerErrorException(NO_SE_PUDO_GUARDAR);
    }

    return this.toSummary(fila);
  }

  /**
   * El archivo que quien pregunta puede descargar, o 404.
   *
   * Tres comprobaciones, y las tres acaban en el **mismo** cuerpo de error:
   * que el adjunto exista, que su ticket sea de la empresa del token (regla 4)
   * y que el mensaje del que cuelga sea público si quien pide es un cliente
   * (regla 5). El adjunto de una nota interna no es que esté prohibido para el
   * portal: es que **no existe**, y así se contesta.
   *
   * Devuelve el tipo detectado en la subida para que el controlador fuerce la
   * descarga con él (regla 3). Este servicio nunca sirve nada en línea, y no
   * porque no quiera: no tiene forma de hacerlo.
   */
  async download(actor: TicketMessageActor, attachmentId: Id): Promise<AttachmentDownload> {
    const { scope } = resolveScope(actor, 'de la descarga');

    const attachment = await this.messages.findAttachment(attachmentId);
    if (!attachment) throw new NotFoundException(ATTACHMENT_NOT_FOUND);

    const ticket = await this.tickets.findById(attachment.ticketId);
    if (!ticketIsVisible(ticket, scope)) throw new NotFoundException(ATTACHMENT_NOT_FOUND);

    if (scope.restricted && attachment.messageId !== null && attachment.messageId !== undefined) {
      const message = await this.messages.findMessage(attachment.messageId);
      if (!this.isPublicMessageOf(message, attachment.ticketId)) {
        throw new NotFoundException(ATTACHMENT_NOT_FOUND);
      }
    }

    return {
      stream: this.storage.createReadStream(attachment.storageKey),
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.sizeBytes,
    };
  }

  /**
   * Los adjuntos del ticket que quien pregunta puede ver. El filtro de
   * visibilidad lo resuelve el repositorio en el `WHERE`, nunca en memoria: un
   * adjunto de nota interna no aparece en el portal ni siquiera para contarlo
   * (regla 5).
   *
   * El interruptor es `!scope.restricted` --el `kind` del actor-- y **no**
   * `ids.clientUserId === null`, que era la versión anterior. Esa se apagaba
   * sola cuando le faltaba el dato: un actor de cliente sin `clientUserId`
   * (`assertClientScope` no lo mira, solo comprueba el `clientId`) salía con
   * las notas internas incluidas. Es exactamente la forma de fallo abierto que
   * `ClientScope` existe para erradicar, y por eso la pregunta se le hace al
   * tipo del actor y nunca a la presencia de un valor.
   *
   * Devuelve la proyección, no las entidades: ver `AttachmentSummary`.
   */
  async list(actor: TicketMessageActor, ticketId: Id): Promise<AttachmentSummary[]> {
    const { scope } = resolveScope(actor, 'de la petición');
    const ticket = await loadVisibleTicketOrFail(this.tickets, ticketId, scope);
    const filas = await this.messages.listAttachments(ticket.id, {
      includeInternal: !scope.restricted,
    });
    return filas.map((fila) => this.toSummary(fila));
  }

  /**
   * La fila, reducida a lo que se puede enseñar. Campo por campo y sin
   * `spread`: lo que no se nombra aquí no sale de este servicio, incluida
   * cualquier columna que se le añada mañana a la entidad.
   */
  private toSummary(fila: TicketAttachment): AttachmentSummary {
    return {
      id: fila.id,
      messageId: fila.messageId,
      filename: fila.filename,
      mimeType: fila.mimeType,
      size: fila.sizeBytes,
      createdAt: fila.createdAt,
    };
  }

  /**
   * El mensaje del que se puede colgar un adjunto, o 404 -- el mismo cuerpo
   * para el que no existe, el que es de otro ticket y (si pregunta un cliente)
   * el que es una nota interna.
   *
   * Que el mensaje sea **de este ticket** no es formalismo: la visibilidad del
   * adjunto se deriva luego de `message_id` con un `JOIN`, así que una fila que
   * apunte a un mensaje de otro ticket heredaría una visibilidad que nadie
   * eligió.
   */
  private async loadAttachableMessage(
    ticket: Ticket,
    messageId: Id,
    scope: ClientScope,
  ): Promise<TicketMessage> {
    const message = await this.messages.findMessage(messageId);

    const ajeno = !message || !sameId(message.ticketId, ticket.id);
    const invisible = scope.restricted && message?.visibility !== 'PUBLICA';
    if (ajeno || invisible) throw new NotFoundException(MESSAGE_NOT_FOUND);

    return message!;
  }

  /**
   * El nombre ya despojado y dentro de la columna, o un 400 limpio.
   *
   * El orden importa: primero se despoja y **después** se mide, porque lo que
   * tiene que caber en `VARCHAR(255)` es lo que de verdad se va a insertar.
   *
   * Se rechaza en vez de recortar: recortar un nombre de 300 caracteres deja al
   * cliente con un archivo llamado de otra forma y sin saber por qué, y la
   * pantalla de subida puede avisar antes de gastar la red. Lo que sí cae en un
   * rótulo genérico es el nombre que se queda **vacío** al despojarlo: es un
   * dato decorativo, y tumbar por eso una subida legítima (un pegado del
   * portapapeles, por ejemplo) sería peor que enseñar «archivo».
   */
  private assertUsableFilename(raw: string): string {
    const filename = sanitizeFilename(raw);
    if (filename.length > MAX_FILENAME_LENGTH) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: `El nombre del archivo no puede pasar de ${MAX_FILENAME_LENGTH} caracteres. Renómbralo y vuelve a subirlo.`,
      });
    }
    return filename;
  }

  /** Si ese mensaje existe, es de ese ticket y es público. Falla cerrado ante `null`. */
  private isPublicMessageOf(message: TicketMessage | null, ticketId: Id): boolean {
    return !!message && sameId(message.ticketId, ticketId) && message.visibility === 'PUBLICA';
  }

  /**
   * Corta la subida si el ticket ya no admite más bytes **de cliente**.
   *
   * Se suma en el servidor lo ya guardado: lo que diga el navegador es una
   * comodidad, no una defensa (spec §4, regla 5). Y se suma solo lo de origen
   * cliente, porque `MAX_TICKET_BYTES` no aplica al equipo -- comparar el total
   * del ticket contra ese tope dejaría a un técnico sin poder adjuntar el
   * parche en su propio ticket.
   *
   * El mensaje dice **qué hacer**, no solo que está lleno: quien lo lee es un
   * cliente que necesita hacer llegar ese archivo igualmente.
   */
  private async assertClientBudget(ticketId: Id, size: number): Promise<void> {
    const used = await this.messages.sumClientBytes(ticketId);
    if (used + size <= MAX_TICKET_BYTES) return;

    throw new PayloadTooLargeException({
      code: 'PAYLOAD_TOO_LARGE',
      message:
        `Este ticket ya ha alcanzado el máximo de ${enMegabytes(MAX_TICKET_BYTES)} en archivos adjuntos. ` +
        'Envíaselo al técnico que lo lleva por otra vía para que lo adjunte él, o abre un ticket nuevo.',
    });
  }

  /**
   * La clave del almacenamiento, generada **entera por el servidor**: la regla
   * más grave del diseño (§4, regla 1), porque un nombre con `../` escribiendo
   * fuera del directorio es la forma más antigua de tomar un servidor.
   *
   * Tres propiedades:
   *
   * - **El nombre que sube el cliente no participa.** Ni saneado, ni recortado,
   *   ni «solo la extensión»: no entra. Lo que no se usa no hay que sanearlo
   *   bien, que es la única forma de no sanearlo mal alguna vez.
   * - **No adivinable**: un UUID v4, no un contador ni una marca de tiempo. Los
   *   archivos los sirve el backend detrás del guard, así que la clave no es la
   *   contraseña -- pero que tampoco lo sea el día que alguien monte un
   *   `CDN` delante no cuesta nada hoy.
   * - **Agrupada por ticket**: `tickets/<id>/…`, que deja el borrado por ticket
   *   y la auditoría de cuánto ocupa cada uno en una sola carpeta.
   *
   * El `id` del ticket sale de la fila ya leída (lo devolvió la propia base),
   * no del parámetro de la URL, y aun así se comprueba que sean solo dígitos:
   * es la única parte de la clave que no es un UUID, y afirmar «la clave la
   * genera el servidor» exige que ningún carácter de ella venga de fuera.
   * `LocalStorageService.getPath` vuelve a comprobar la contención después --
   * es la segunda red, no la primera.
   */
  private storageKeyFor(ticketId: Id, mimeType: AllowedMimeType): string {
    return `tickets/${this.assertNumericSegment(ticketId)}/${randomUUID()}.${EXTENSIONS[mimeType]}`;
  }

  private assertNumericSegment(value: Id): string {
    const segment = String(value);
    if (!/^[0-9]+$/.test(segment)) {
      this.logger.error(`Id de ticket no numérico al componer la clave: «${segment}».`);
      throw new InternalServerErrorException(NO_SE_PUDO_GUARDAR);
    }
    return segment;
  }

  /**
   * Escribe el archivo, o convierte el fallo en un `{ code, message }` en
   * español. Sin esto, un `ENOSPC` --o el `INVALID_STORAGE_KEY` de `getPath`,
   * que a estas alturas solo puede ser un fallo nuestro-- saldría como el
   * «Internal server error» genérico del filtro global.
   */
  private async writeOrFail(buffer: Buffer, key: string, mimeType: string): Promise<void> {
    try {
      await this.storage.save(buffer, key, mimeType);
    } catch (cause) {
      this.logger.error(`No se pudo escribir el adjunto «${key}».`, cause as Error);
      throw new InternalServerErrorException(NO_SE_PUDO_GUARDAR);
    }
  }

  /**
   * Borra el archivo que se quedó sin fila. Si el borrado también falla, se
   * registra la clave --que es lo que hace falta para barrerlo a mano-- y se
   * sigue adelante: el error que verá quien subió es el de la subida, nunca el
   * de la limpieza.
   */
  private async discardOrphan(key: string, cause: unknown): Promise<void> {
    this.logger.error(
      `Falló el INSERT del adjunto «${key}»: se borra el archivo ya escrito.`,
      cause as Error,
    );
    try {
      await this.storage.remove(key);
    } catch (removeError) {
      this.logger.error(
        `Tampoco se pudo borrar «${key}»: queda huérfano en disco y hay que barrerlo a mano.`,
        removeError as Error,
      );
    }
  }
}
