import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

import { serveAttachment } from '../../common/http/attachment-response';
import { decodeMultipartFilename } from '../../common/http/multipart-filename';
import { isUsableId } from '../../common/ids';
import { CurrentClientUser } from '../portal/decorators/current-client-user.decorator';
import { ClientJwtGuard } from '../portal/guards/client-jwt.guard';
import { AuthClientUser } from '../portal/strategies/client-jwt.strategy';
// El mismo tope que aplica el panel, derivado de `MAX_FILE_BYTES` en el
// dominio: la primera criba de multer, no la validación.
import { ATTACHMENT_UPLOAD_LIMITS } from './domain/attachment-rules';
import { CreatePortalMessageDto } from './dto/create-message.dto';
import {
  PortalAttachmentView,
  PortalMessageAuthor,
  PortalMessageView,
  PortalPostedMessageView,
} from './dto/portal-message.dto';
import { TicketMessage } from './entities/ticket-message.entity';
import { AttachmentUploadErrorsInterceptor } from './interceptors/attachment-upload-errors.interceptor';
import { AttachmentSummary, TicketAttachmentsService } from './ticket-attachments.service';
import { TicketMessageActor, TicketMessagesService } from './ticket-messages.service';

/**
 * `ParseIntPipe` de serie contesta «Validation failed (numeric string is
 * expected)»: inglés y jerga de framework. Se le da la forma `{ code, message }`
 * del proyecto, igual que en `portal-tickets.controller.ts`.
 */
const idPipe = new ParseIntPipe({
  exceptionFactory: () =>
    new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'El identificador no es válido.',
    }),
});

/**
 * El hilo de un ticket y sus adjuntos, **para el portal de clientes**. El panel
 * tiene su propia superficie (`TicketMessagesController`) y su propio guard.
 *
 * No es una copia de aquel. Aquí valen tres cosas que allí no:
 *
 * 1. **Los dos identificadores salen del token**, siempre. Ni del cuerpo, ni de
 *    la URL, ni de la query: un endpoint del portal que acepte un `clientId` de
 *    fuera es un fallo de seguridad (spec §4.2), y que hoy el `ValidationPipe`
 *    lo rechazara no es motivo para escribir la puerta abierta.
 * 2. **Las notas internas no existen.** No se listan, no se cuentan y no se
 *    pueden escribir: `CreatePortalMessageDto` ni siquiera declara
 *    `visibility`, y este controlador no reenvía la clave.
 * 3. **La respuesta se proyecta campo por campo** (ver `portal-message.dto.ts`).
 *
 * Lo que **no** hace, y es lo que más importa: no toma ninguna decisión de
 * visibilidad, de autoría ni de pertenencia. Quién ve qué, de quién es el
 * ticket y qué visibilidad tiene un mensaje lo decide `TicketMessagesService` /
 * `TicketAttachmentsService`, con el `kind` del actor y no con la presencia de
 * ningún dato. Repartir esa política entre dos capas es exactamente cómo se
 * actualiza una y se olvida la otra -- en este módulo ya ha pasado cuatro
 * veces. Aquí solo se saca el actor del token, se pregunta, y se proyecta.
 */
@Controller('portal')
@UseGuards(ClientJwtGuard)
export class PortalMessagesController {
  constructor(
    private readonly messages: TicketMessagesService,
    private readonly attachments: TicketAttachmentsService,
  ) {}

  /**
   * El hilo con sus adjuntos dentro.
   *
   * Son dos consultas al servicio --el hilo y los adjuntos-- y las dos van con
   * el mismo actor, así que las dos vuelven ya filtradas: la nota interna no
   * está en la primera y su adjunto no está en la segunda (el repositorio lo
   * resuelve con un `INNER JOIN`, no en memoria). Agruparlas aquí es un
   * emparejamiento por `messageId`, no una decisión de visibilidad: este
   * controlador no podría dejar fuera una nota interna aunque quisiera, porque
   * no llega a verla.
   */
  @Get('tickets/:ticketId/messages')
  async listThread(
    @CurrentClientUser() user: AuthClientUser,
    @Param('ticketId', idPipe) ticketId: number,
  ): Promise<PortalMessageView[]> {
    const actor = clientActor(user);
    const [messages, attachments] = await Promise.all([
      this.messages.listThread(actor, ticketId),
      this.attachments.list(actor, ticketId),
    ]);

    return toThreadView(messages, attachments);
  }

  /**
   * Escribe en el hilo. Al servicio le llega **solo** el cuerpo del mensaje: la
   * visibilidad no se pasa ni como `undefined`, porque no hay ninguna que el
   * portal pueda elegir. (El servicio vuelve a forzar `PUBLICA` para todo actor
   * de cliente; esta es la primera puerta, no la única.)
   */
  @Post('tickets/:ticketId/messages')
  async post(
    @CurrentClientUser() user: AuthClientUser,
    @Param('ticketId', idPipe) ticketId: number,
    @Body() dto: CreatePortalMessageDto,
  ): Promise<PortalPostedMessageView> {
    const { message, ticket } = await this.messages.post(clientActor(user), ticketId, {
      bodyMd: dto.bodyMd,
    });

    // Recién escrito, todavía no puede tener adjuntos: se cuelgan después, con
    // su `id`, por la ruta de abajo.
    return { message: toMessageView(message, []), ticketStatus: ticket.status };
  }

  /**
   * Sube un adjunto **a un mensaje**. El `messageId` va en la ruta porque no es
   * opcional: un adjunto sin mensaje no hereda ninguna visibilidad, y el
   * servicio lo rechaza. Que la URL lo exija evita que la petición exista.
   */
  @Post('tickets/:ticketId/messages/:messageId/attachments')
  // El orden importa: el traductor va **por delante**, porque es su
  // `next.handle()` el que envuelve a `FileInterceptor` y el único sitio desde
  // el que se ve el error que produce la propia subida.
  @UseInterceptors(
    AttachmentUploadErrorsInterceptor,
    FileInterceptor('file', { limits: ATTACHMENT_UPLOAD_LIMITS }),
  )
  async upload(
    @CurrentClientUser() user: AuthClientUser,
    @Param('ticketId', idPipe) ticketId: number,
    @Param('messageId', idPipe) messageId: number,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<PortalAttachmentView> {
    if (!file) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Falta el archivo a adjuntar en el campo «file».',
      });
    }

    // Lo que llega de multer, con los nombres que el dominio usa para recordar
    // de qué se fía: `declaredMime` y `declaredSize` los pone quien sube y no
    // deciden nada; la autoridad es el buffer.
    const adjunto = await this.attachments.upload(clientActor(user), ticketId, messageId, {
      buffer: file.buffer,
      declaredMime: file.mimetype,
      filename: decodeMultipartFilename(file.originalname),
      declaredSize: file.size,
    });

    return toAttachmentView(adjunto);
  }

  /**
   * Sirve el fichero. Cuelga de `attachments/:id` --y no de `tickets/:id/…`--
   * por lo mismo que en el panel: el servicio localiza el adjunto por su id y
   * comprueba desde él de quién es el ticket, así que un `ticketId` en la ruta
   * sería un dato que nadie contrasta.
   *
   * Un adjunto de otra empresa y uno de una nota interna dan el **mismo** 404
   * que uno que no existe, y lo decide el servicio.
   */
  @Get('attachments/:attachmentId/download')
  async download(
    @CurrentClientUser() user: AuthClientUser,
    @Param('attachmentId', idPipe) attachmentId: number,
    @Res() res: Response,
  ): Promise<void> {
    // Si esto lanza (404 del servicio), no se ha escrito ninguna cabecera y el
    // filtro global puede contestar con su JSON de siempre.
    const download = await this.attachments.download(clientActor(user), attachmentId);

    // Forzada, con `nosniff` y con el nombre ASCII en el `filename=`: lo mismo
    // que sirve el panel, desde la misma función. Ver `serveAttachment`.
    await serveAttachment(res, download);
  }
}

/**
 * El actor de cliente, y el único que este controlador sabe construir.
 *
 * **Los dos identificadores salen del token** que `ClientJwtGuard` acaba de
 * verificar, sin ninguna rama: aquí no hay ningún «si falta tal cosa,
 * entonces…». Que los dos sean utilizables lo comprueba `resolveScope`, que
 * falla cerrado con un 401 y sin consultar nada. Comprobarlo también aquí sería
 * una segunda copia de una decisión ya tomada, y la copia es la que se queda
 * vieja: en este módulo, cuatro veces.
 *
 * El `clientId` es lo único que separa a una empresa de otra y el
 * `clientUserId` es quien firma el mensaje; ninguno de los dos puede llegar
 * nunca del cuerpo, la URL ni la query.
 */
function clientActor(user: AuthClientUser): TicketMessageActor {
  return { kind: 'CLIENT', clientUserId: user.clientUserId, clientId: user.clientId };
}

/**
 * Empareja cada adjunto con su mensaje. Por el valor del identificador y no con
 * `===`, porque TypeORM hidrata **toda** columna `bigint` como cadena: con la
 * comparación estricta, el `messageId` `"12"` de un adjunto no encontraría
 * nunca al mensaje `12` y el hilo saldría sin ningún adjunto.
 *
 * Un adjunto que no case con ningún mensaje del hilo no se publica. No es una
 * decisión de visibilidad tomada aquí --el servicio ya solo devuelve los que
 * cuelgan de un mensaje público de este ticket-- sino la consecuencia de que
 * los adjuntos viajen dentro de su mensaje: sin mensaje al que pertenecer, no
 * hay dónde ponerlo, y publicarlo suelto sería inventarle un sitio.
 */
function toThreadView(
  messages: TicketMessage[],
  attachments: AttachmentSummary[],
): PortalMessageView[] {
  const porMensaje = new Map<string, PortalAttachmentView[]>();
  for (const attachment of attachments) {
    const clave = String(attachment.messageId);
    const lista = porMensaje.get(clave);
    if (lista) lista.push(toAttachmentView(attachment));
    else porMensaje.set(clave, [toAttachmentView(attachment)]);
  }

  return messages.map((message) => toMessageView(message, porMensaje.get(String(message.id)) ?? []));
}

/** Campo por campo, nunca con `spread` ni `delete`. Ver `portal-message.dto.ts`. */
function toMessageView(
  message: TicketMessage,
  attachments: PortalAttachmentView[],
): PortalMessageView {
  return {
    id: Number(message.id),
    bodyMd: message.bodyMd,
    author: authorOf(message),
    createdAt: toIso(message.createdAt),
    attachments,
  };
}

/** Ídem. `messageId`, `storageKey` y quién lo subió se quedan fuera. */
function toAttachmentView(attachment: AttachmentSummary): PortalAttachmentView {
  return {
    id: Number(attachment.id),
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    createdAt: toIso(attachment.createdAt),
  };
}

/**
 * De qué lado viene el mensaje.
 *
 * **Se exige la prueba positiva para atribuírselo al equipo**: que la fila
 * traiga un `author_user_id` utilizable y no traiga el del cliente. Lo contrario
 * --dar por «del equipo» todo lo que no tenga autor de cliente-- es la forma que
 * ha fallado cuatro veces en este módulo: un guardia que se apaga justo cuando
 * le falta el dato. Aquí ese fallo tendría una cara concreta y fea, porque una
 * fila sin autor (que el esquema admite y que solo un fallo de programación
 * puede escribir, ver `resolveActorIds`) le presentaría al cliente sus propias
 * palabras, o las de nadie, **firmadas por Kubo**. Poner en boca del equipo algo
 * que el equipo no dijo es el único error de los dos que no se puede recoger.
 *
 * Así que la duda cae siempre del lado del cliente: es su hilo, y verse
 * atribuido un mensaje propio es raro pero inofensivo.
 *
 * Es la lectura inversa del reparto que hace `resolveActorIds` al escribir --
 * `kind` → columnas -- y es la única pregunta que se le puede hacer a la fila:
 * quién escribió un mensaje **es** lo que dicen sus dos columnas de autor. No
 * hay aquí ninguna política que el servicio ya tenga tomada; si la hubiera,
 * estaría allí.
 */
function authorOf(message: TicketMessage): PortalMessageAuthor {
  const loFirmaElEquipo =
    isUsableId(message.authorUserId) && !isUsableId(message.authorClientUserId);

  return loFirmaElEquipo ? 'STAFF' : 'CLIENT';
}

/**
 * La fecha, en ISO 8601 y en UTC.
 *
 * El driver de MySQL devuelve `Date` para las columnas `datetime`, pero un
 * repositorio que use `getRawOne` o una prueba que fije la fila a mano pueden
 * dar la cadena; las dos formas acaban en el mismo texto. Es formato, no
 * política: por eso hay un gemelo en `portal-tickets.service.ts` y no se
 * comparten -- aquel admite nulos porque `resolved_at` y `closed_at` lo son, y
 * `created_at` no lo es en ninguna de las dos tablas de este hilo.
 */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
