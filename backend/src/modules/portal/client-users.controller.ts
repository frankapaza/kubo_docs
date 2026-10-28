import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ApiThrottlerGuard } from '../../common/guards/api-throttler.guard';
import { BULK_INVITE_THROTTLE, BULK_REVIEW_THROTTLE } from '../../config/throttler.config';
import { ClientUsersService } from './client-users.service';
import { BulkReviewResult, BulkSendResult, ClientUsersBulkService } from './client-users-bulk.service';
import { BULK_TEMPLATE_FILENAME, BULK_TEMPLATE_MIME } from './bulk-users-workbook';
import { BULK_UPLOAD_LIMITS } from './domain/bulk-user-file';
import { ConfirmBulkInviteDto } from './dto/bulk-users.dto';
import { BulkUploadErrorsInterceptor } from './interceptors/bulk-upload-errors.interceptor';
import { ClientUserView, CreateClientUserDto, UpdateClientUserDto } from './dto/client-user.dto';

/**
 * Superficie del panel interno para dar de alta y gestionar a los usuarios
 * del portal de las empresas cliente. Hasta esta tarea había que insertarlos
 * a mano en la base.
 */
@Controller('client-users')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class ClientUsersController {
  constructor(
    private readonly service: ClientUsersService,
    private readonly bulk: ClientUsersBulkService,
  ) {}

  @Get()
  list(@Query('clientId', ParseIntPipe) clientId: number): Promise<ClientUserView[]> {
    return this.service.listByClient(clientId);
  }

  /**
   * La plantilla que se rellena. **Se genera en el servidor** (decisión 1 de la
   * spec): el análisis tiene que ocurrir donde se puede validar, y generar aquí
   * mantiene la plantilla y el analizador pegados — si mañana cambia una
   * columna, cambia en el mismo sitio.
   *
   * `@Roles('ADMIN')` aunque no lea datos de nadie: es el primer paso de una
   * operación que solo un ADMIN puede terminar, y dejar que un rol menor se la
   * descargue para chocar contra un 403 al subirla es una pantalla que promete
   * algo que no puede cumplir. Es la decisión más blanda de las tres y está
   * anotada como tal en la spec.
   */
  @Get('carga-masiva/plantilla')
  @Roles('ADMIN')
  async bulkTemplate(@Res() res: Response): Promise<void> {
    const buffer = await this.bulk.template();
    // Descarga forzada y `nosniff`, igual que los adjuntos: el nombre es ASCII
    // por construcción, así que no hace falta la codificación RFC 5987 de
    // `serveAttachment` — y ese ayudante sirve flujos, no buffers.
    res.setHeader('Content-Disposition', `attachment; filename="${BULK_TEMPLATE_FILENAME}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', BULK_TEMPLATE_MIME);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  /**
   * Analiza el archivo y devuelve qué pasaría con cada fila. **No manda ningún
   * correo y no escribe nada** (decisión 3 de la spec).
   *
   * `@HttpCode(200)` y no 201: no se ha creado nada.
   *
   * **El `clientId` va en la query y no en el cuerpo**, y no es un capricho: el
   * cuerpo aquí es multipart, donde todo campo llega como cadena y la
   * validación de un `@Body()` se vuelve un asunto de conversiones implícitas.
   * En la query lo mira `ParseIntPipe` y se acabó — el mismo sitio del que ya
   * lo toma `list`, unas líneas más arriba.
   *
   * Efecto lateral bueno: `req.body` queda vacío, así que los nombres y
   * correos del archivo **no se copian a `audit_log` en el paso que no hace
   * nada**. Se copian en el envío, que es donde el asiento tiene sentido.
   *
   * **Lleva tope de frecuencia, y no por el correo:** no manda ninguno. Cada
   * revisión arranca un hilo con 64 MB de tope para abrir el libro, y ese hilo
   * acota lo que puede hacer UNA bomba de descompresión pero no el agregado.
   * El tope es mucho más laxo que el del envío —corregir y volver a subir es
   * justo lo que este paso existe para permitir—. Ver `BULK_REVIEW_THROTTLE`.
   */
  @Post('carga-masiva/revision')
  @Roles('ADMIN')
  @HttpCode(200)
  @UseGuards(ApiThrottlerGuard)
  @Throttle(BULK_REVIEW_THROTTLE)
  // El orden importa: el traductor va POR DELANTE, porque es su `next.handle()`
  // el que envuelve a `FileInterceptor` y el único sitio desde el que se ve el
  // error que produce la propia subida.
  @UseInterceptors(
    BulkUploadErrorsInterceptor,
    FileInterceptor('file', { limits: { ...BULK_UPLOAD_LIMITS, fields: 0 } }),
  )
  async bulkReview(
    @Query('clientId', ParseIntPipe) clientId: number,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<BulkReviewResult> {
    if (!file) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Falta el archivo en el campo «file». Descarga la plantilla, rellénala y súbela.',
      });
    }
    return this.bulk.review(clientId, file.buffer);
  }

  /**
   * Manda los correos de una revisión ya confirmada.
   *
   * **El único sitio de esta funcionalidad con tope de frecuencia**, y no por
   * el motivo del tope de invitar del portal —allí cierra un oráculo que aquí
   * no existe— sino por el de `NOTIFICATION_TEST_THROTTLE`: efecto externo e
   * irreversible. Ver `BULK_INVITE_THROTTLE`.
   *
   * **La empresa va en la URL (`?clientId=N`) aunque ya vaya dentro del bloque
   * firmado**, y no por seguridad —cotejarla no añade ninguna: el bloque lo
   * firma el servidor y el operador está autorizado para todas las empresas—
   * sino para que la petición diga para qué empresa fue. El servicio la coteja
   * con la firmada y rechaza si no coinciden; y la respuesta repite el
   * `clientId`, porque `audit_log` guarda la plantilla de la ruta y no la
   * query, y así el asiento sí lleva la empresa.
   *
   * `user.id` sale del token que `JwtAuthGuard` acaba de verificar; el cuerpo
   * solo aporta la revisión y su firma, y **no trae ninguna empresa**: esa va
   * dentro del bloque firmado.
   */
  @Post('carga-masiva/envio')
  @Roles('ADMIN')
  @HttpCode(200)
  @UseGuards(ApiThrottlerGuard)
  @Throttle(BULK_INVITE_THROTTLE)
  bulkSend(
    @CurrentUser() user: AuthUser,
    @Query('clientId', ParseIntPipe) clientId: number,
    @Body() dto: ConfirmBulkInviteDto,
  ): Promise<BulkSendResult> {
    return this.bulk.send(user.id, clientId, dto);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateClientUserDto,
  ): Promise<ClientUserView> {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClientUserDto,
  ): Promise<ClientUserView> {
    return this.service.update(id, dto);
  }
}
