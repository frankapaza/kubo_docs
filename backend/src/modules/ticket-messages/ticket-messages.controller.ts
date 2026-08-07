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
import { pipeline } from 'stream/promises';

import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { MAX_FILE_BYTES } from './domain/attachment-rules';
import { CreateMessageDto } from './dto/create-message.dto';
import { AttachmentUploadErrorsInterceptor } from './interceptors/attachment-upload-errors.interceptor';
import { AttachmentDownload, TicketAttachmentsService } from './ticket-attachments.service';
import { TicketMessageActor, TicketMessagesService } from './ticket-messages.service';

/**
 * El tope que multer aplica **antes** de tener el fichero entero en memoria.
 *
 * Es la primera criba y nada más: sirve para no tragarse 500 MB en RAM por una
 * petición, no para decidir si el adjunto entra. Quien decide eso es
 * `assertAcceptable`, midiendo `buffer.length` -- el tamaño real, nunca el
 * declarado -- y mirando la firma de bytes. Se exporta para que un test pueda
 * sujetar que los dos topes son **el mismo número**: si divergieran, uno de los
 * dos le estaría mintiendo a quien sube.
 */
export const ATTACHMENT_UPLOAD_LIMITS = { fileSize: MAX_FILE_BYTES } as const;

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
 * Los caracteres que `encodeURIComponent` deja pasar y que **no** son
 * `attr-char` (RFC 5987 §3.2.1): `!`, `'`, `(`, `)`, `*`. `~`, `-`, `.` y `_`
 * sí lo son y se quedan como están.
 *
 * `sanitizeFilename` ya quita el `'`, el `*` y el `%` del nombre guardado, pero
 * la cabecera no debe apoyarse en eso: quien la compone tiene que emitir un
 * `ext-value` válido con cualquier cadena que le den.
 */
const NO_ATTR_CHAR = /[!'()*]/g;

/**
 * El nombre real, codificado como el `ext-value` de la RFC 5987.
 *
 * Es lo que hace que al cliente le llegue `facturación.pdf` y no
 * `facturacion.pdf`. **Es una mejora, no la defensa**: la defensa es que el
 * `filename=` de al lado sea `headerFilename`, que es ASCII por construcción.
 */
function rfc5987(filename: string): string {
  return encodeURIComponent(filename).replace(
    NO_ATTR_CHAR,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * El nombre que de verdad mandó quien subió el fichero.
 *
 * **`file.originalname` no lo es.** Busboy decodifica el `filename=` del
 * multipart como **latin1**, y multer 1.4.5 no le pasa `defParamCharset` ni
 * expone forma de configurarlo: cualquier nombre en UTF-8 -- que es lo que
 * manda todo navegador actual -- llega hecho mojibake. Comprobado contra el
 * backend real: `facturación.png` se guardaba como `facturaciÃ³n.png`, y
 * `文件.png` como `æ–‡ä»¶.png`. Se deshace aquí, en la frontera HTTP, porque es
 * la única capa que sabe de multipart; el servicio recibe ya el nombre bueno.
 *
 * **Solo se reinterpreta si los bytes vuelven idénticos.** Un nombre que de
 * verdad venía en latin1 (`café.png` con la `é` en un byte) no es UTF-8 válido,
 * y forzar la conversión le metería un `U+FFFD`: quedaría peor que antes. La
 * primera condición descarta lo que ya no está en el rango latin1 -- si alguien
 * arregla esto aguas arriba, este código se convierte en un no-op en vez de
 * romperlo.
 *
 * No decide nada sobre quién ve qué: es una cuestión de codificación de la
 * capa de transporte, y el nombre no gobierna ninguna regla (ni la clave de
 * almacenamiento, ni el tipo, ni la visibilidad).
 */
function decodeMultipartFilename(originalname: string): string {
  const recibido = originalname ?? '';
  const bytes = Buffer.from(recibido, 'latin1');
  if (bytes.toString('latin1') !== recibido) return recibido;

  const comoUtf8 = bytes.toString('utf8');
  return Buffer.from(comoUtf8, 'utf8').equals(bytes) ? comoUtf8 : recibido;
}

/**
 * La cabecera `Content-Disposition` de una descarga.
 *
 * **Siempre `attachment`.** Nunca `inline`, ni siquiera para las imágenes, y
 * eso no es exceso de celo: existen ficheros que son a la vez un PNG válido y
 * un HTML válido, la detección por firma de bytes los ve como PNG (solo mira la
 * cabecera del fichero) y no hay antivirus detrás. Servir eso en línea lo
 * ejecutaría en el origen de la aplicación. Junto con `nosniff` es la segunda
 * barrera del diseño (spec §4, regla 3), y la única que cubre ese caso.
 *
 * **`filename=` lleva `headerFilename` y no `filename`.** Los dos nombres que
 * devuelve el servicio no son intercambiables: `headerFilename` es ASCII
 * imprimible sin comillas, sin `;` y sin `%`, y promete poder interpolarse aquí
 * sin comprobar nada. `filename` es el original, y con un solo carácter fuera
 * de ASCII (`文件.pdf`, `foto😀.png`) `res.setHeader` lanza `ERR_INVALID_CHAR`:
 * un 500 que cualquiera provoca subiendo un fichero con un nombre legítimo.
 *
 * El nombre de verdad viaja detrás, en la forma codificada, que es donde sí
 * cabe. Los clientes que la entienden (todos los navegadores actuales) usan
 * esa; los que no, se quedan con la ASCII y descargan igual.
 */
function contentDisposition(download: AttachmentDownload): string {
  return `attachment; filename="${download.headerFilename}"; filename*=UTF-8''${rfc5987(download.filename)}`;
}

/**
 * El hilo de un ticket y sus adjuntos, para el **panel interno**. El portal
 * tiene su propia superficie y su propio guard.
 *
 * Este controlador no toma **ninguna** decisión de visibilidad, de autoría ni
 * de pertenencia: construye el actor del equipo con el id del token, se lo pasa
 * al servicio y devuelve lo que le dé. Quién es el autor, qué visibilidad tiene
 * el mensaje, de quién es el ticket y qué adjuntos se pueden ver lo decide
 * `TicketMessagesService` / `TicketAttachmentsService`, que es donde están las
 * tres invariantes y donde las comprueban también las peticiones del portal.
 * Repartir esa política entre dos capas es exactamente cómo se actualiza una y
 * se olvida la otra.
 *
 * `RolesGuard` va montado por coherencia con el resto del panel, pero ninguna
 * ruta declara `@Roles`: responder en un ticket, escribir una nota interna y
 * adjuntar un fichero es trabajo de soporte, no de administración. Lo que
 * `@Roles('ADMIN')` protege en los controladores hermanos son catálogos
 * (`support-agents`, plantillas), no el trabajo del día.
 */
@Controller()
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class TicketMessagesController {
  constructor(
    private readonly messages: TicketMessagesService,
    private readonly attachments: TicketAttachmentsService,
  ) {}

  @Get('tickets/:ticketId/messages')
  listThread(@CurrentUser() user: AuthUser, @Param('ticketId', idPipe) ticketId: number) {
    return this.messages.listThread(staffActor(user), ticketId);
  }

  @Post('tickets/:ticketId/messages')
  post(
    @CurrentUser() user: AuthUser,
    @Param('ticketId', idPipe) ticketId: number,
    @Body() dto: CreateMessageDto,
  ) {
    // `visibility` viaja tal cual, incluido `undefined`: el servicio es quien
    // decide, y para un actor del equipo su omisión ya significa `PUBLICA`.
    return this.messages.post(staffActor(user), ticketId, {
      bodyMd: dto.bodyMd,
      visibility: dto.visibility,
    });
  }

  @Get('tickets/:ticketId/attachments')
  listAttachments(@CurrentUser() user: AuthUser, @Param('ticketId', idPipe) ticketId: number) {
    return this.attachments.list(staffActor(user), ticketId);
  }

  /**
   * Sube un adjunto **a un mensaje**. El `messageId` va en la ruta y no en el
   * cuerpo porque no es opcional: un adjunto sin mensaje no hereda ninguna
   * visibilidad, y el servicio lo rechaza. Que la propia URL lo exija evita que
   * la petición llegue a existir.
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
    @CurrentUser() user: AuthUser,
    @Param('ticketId', idPipe) ticketId: number,
    @Param('messageId', idPipe) messageId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Falta el archivo a adjuntar en el campo «file».',
      });
    }

    // Lo que llega de multer, con los nombres que el dominio usa para recordar
    // de qué se fía: `declaredMime` y `declaredSize` los pone quien sube y no
    // deciden nada; la autoridad es el buffer.
    return this.attachments.upload(staffActor(user), ticketId, messageId, {
      buffer: file.buffer,
      declaredMime: file.mimetype,
      filename: decodeMultipartFilename(file.originalname),
      declaredSize: file.size,
    });
  }

  /**
   * Sirve el fichero. Cuelga de `attachments/:id` y no de `tickets/:ticketId/…`
   * a propósito: el servicio localiza el adjunto por su id y comprueba desde él
   * de quién es el ticket, así que un `ticketId` en la ruta sería un dato que
   * nadie contrasta -- y una ruta que parece comprobar algo que no comprueba es
   * peor que no tenerla.
   */
  @Get('attachments/:attachmentId/download')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('attachmentId', idPipe) attachmentId: number,
    @Res() res: Response,
  ): Promise<void> {
    // Si esto lanza (404 del servicio), no se ha escrito ninguna cabecera y el
    // filtro global puede contestar con su JSON de siempre.
    const download = await this.attachments.download(staffActor(user), attachmentId);

    // **Las dos de seguridad, primero.** Si escribir el nombre llegara a
    // lanzar, lo que quedaría escrito en la respuesta ya obliga a descargar; al
    // revés, el filtro global serviría su JSON de error encima de un
    // `Content-Type: image/png` sin `nosniff`. Hoy es inalcanzable --el
    // servicio garantiza que `headerFilename` es ASCII imprimible-- pero el
    // orden no cuesta nada y no depende de esa garantía.
    res.setHeader('Content-Disposition', contentDisposition(download));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', download.mimeType);
    res.setHeader('Content-Length', String(download.size));

    // `pipeline` y no `stream.pipe(res)`.
    //
    // `pipe` no limpia: si el cliente se va a mitad de la descarga --cerrar la
    // pestaña, perder la cobertura, pulsar atrás: lo más normal que hace un
    // usuario-- la respuesta muere y **el flujo de lectura se queda abierto**,
    // con su descriptor de fichero. Los descriptores no se recuperan solos: se
    // acumulan hasta el límite del proceso y entonces falla *todo*, no solo las
    // descargas, semanas después y sin parecerse a su causa. `pipeline`
    // destruye los dos extremos en todos los caminos -- fin normal, error de
    // origen y cliente que se va -- y ese es el motivo principal de usarlo.
    //
    // De paso resuelve el otro: `pipeline` mira el estado del origen en vez de
    // esperar un evento, así que un flujo que **ya** falló --el `ENOENT` que
    // llega antes de que nadie más escuche-- se ve igual y la petición se
    // cierra en vez de quedarse colgada con su `Content-Length` y sin cuerpo.
    //
    // El rechazo se traga **a propósito**, y aquí sí que no se pierde nada: el
    // fallo de lectura ya lo registró el servicio con la clave concreta (ver
    // `openOrFail`), y el otro caso --`ERR_STREAM_PREMATURE_CLOSE`, el cliente
    // que aborta-- no es un error, es un martes. Dejarlo escapar sería peor que
    // inútil: las cabeceras ya salieron, así que el filtro global intentaría
    // escribir su JSON sobre una respuesta que `pipeline` acaba de destruir.
    await pipeline(download.stream, res).catch(() => undefined);
  }
}

/**
 * El actor del equipo, y el único que este controlador sabe construir.
 *
 * Sale del `id` que `JwtAuthGuard` dejó en la petición, sin ninguna rama: no
 * hay aquí ningún «si falta tal cosa, entonces…». Un token sin usuario no llega
 * hasta aquí (lo para el guard) y, si llegara, `resolveActorIds` falla cerrado
 * en el servicio.
 */
function staffActor(user: AuthUser): TicketMessageActor {
  return { kind: 'STAFF', userId: user.id };
}
