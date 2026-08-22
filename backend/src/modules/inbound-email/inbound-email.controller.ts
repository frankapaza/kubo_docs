import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { formatPeruDateTime } from '../../common/peru-date-time';

import { InboundEmailsRepository } from './inbound-emails.repository';
import { InboundEmailService } from './inbound-email.service';
import { isRequeuedMessageId } from './domain/retry';
import { isSyntheticMessageId } from './imap-mailbox.service';
import { INBOUND_EMAIL_OUTCOMES, InboundEmail, InboundEmailOutcome } from './entities/inbound-email.entity';
import { WorkspaceService } from '../workspace/workspace.service';

/**
 * Lo que la pantalla de correo entrante (Task 9) necesita de una fila de
 * `inbound_emails`, y ni un campo más.
 *
 * `sentAtLabel`/`receivedAtLabel` van ya formateados en texto
 * (`formatPeruDateTime`, `common/peru-date-time.ts`) -- esta pantalla no le
 * manda al navegador un `Date`/ISO para que lo formatee él: el backend corre
 * en `TZ=UTC`, y este proyecto lleva cinco fallos de zona horaria.
 *
 * **Proyección campo a campo, nunca `{...row}`.** Dos columnas de la tabla se
 * quedan fuera a propósito:
 *
 * - **`messageId`** (el identificador normalizado, con el que se deduplica):
 *   es un detalle de implementación -- puede ser un hash sintético cuando el
 *   correo no traía `Message-ID`, y tras un reintento lleva además el sufijo
 *   `#reintento-...` de `domain/retry.ts`. Nada de eso ayuda a nadie
 *   investigando "a mi cliente no le llegó el ticket"; solo confundiría.
 * - **`messageIdRaw`** sí se publica, con su propio nombre: es el valor que
 *   de verdad aparece en la cabecera del correo, el que una persona de
 *   soporte podría cotejar contra los registros del servidor de correo si
 *   hiciera falta llegar tan lejos.
 *
 * `clientUserId` también se queda fuera: `fromAddress` ya identifica a quién
 * escribió, y resolver un nombre de usuario de cliente aquí exigiría otra
 * consulta que esta pantalla no necesita para lo que hace (investigar y
 * reintentar, no administrar usuarios).
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
  /** Si la pantalla debe ofrecer el botón de reintentar para esta fila. */
  retryable: boolean;
}

/**
 * La proyección de una fila. Función libre y exportada para poder probarla
 * sin montar el controlador.
 *
 * `retryable` exige `outcome === 'ERROR'` **y** las mismas cinco guardas que
 * hacen falta para que `POST :id/retry` de verdad reencole -- ver el
 * docblock de `InboundEmailService.retry` para el porqué de cada una:
 *
 * 1. Que la fila no se haya reencolado ya (`isRequeuedMessageId`, sobre el
 *    `messageId` interno -- nunca expuesto, ver el comentario de
 *    `InboundEmailListItem` arriba). Sin esto, una fila ya reencolada seguiría
 *    ofreciendo el botón para siempre (su `outcome` no cambia), y un segundo
 *    clic reencolaría el mismo correo una segunda vez.
 * 2. Que no tenga ya un `ticketId` asociado: podría tener el mensaje (y su
 *    aviso al cliente) ya escrito, y reencolar arriesgaría un duplicado.
 * 3. Que traiga un `messageIdRaw` propio, no un sustituto sintético
 *    (`isSyntheticMessageId`): sin cabecera `Message-ID` real no hay forma de
 *    localizar el correo de nuevo en el buzón.
 * 4. Que la ingesta esté encendida (`ingestionEnabled`, resuelto una sola vez
 *    por listado, no por fila -- `WorkspaceService.isImapIngestionEnabled`):
 *    apagada -- el estado por defecto -- reencolar no logra nada, porque nada
 *    va a leer el buzón hasta que se encienda.
 * 5. **Que quien pregunta sea ADMIN (`isAdmin`).** El endpoint
 *    (`POST :id/retry`) exige `@Roles('ADMIN')` desde la tanda de cierre,
 *    pero esta pantalla no está protegida por rol -- solo la entrada del
 *    menú lo está, en el frontend, y cualquiera que teclee la URL directa
 *    llega igual. Sin esta guarda, un miembro del personal sin ese rol vería
 *    el botón exactamente igual que un ADMIN, y su clic devolvería un 403 en
 *    vez de reencolar: el mismo clic-sin-salida que esta función ya existe
 *    para evitar con la ingesta apagada, ahora por una causa distinta.
 *
 * **Antes de esta corrección solo se comprobaba la primera.** Con la ingesta
 * apagada (el estado de salida del proyecto), eso significaba que TODAS las
 * filas en error ofrecían un botón que iba a fallar siempre -- el mensaje de
 * error que devuelve el servicio es honesto, pero es un clic sin salida.
 */
export function toInboundEmailListItem(
  row: InboundEmail,
  ingestionEnabled: boolean,
  isAdmin: boolean,
): InboundEmailListItem {
  const retryable =
    row.outcome === 'ERROR' &&
    !isRequeuedMessageId(row.messageId) &&
    row.ticketId === null &&
    row.messageIdRaw !== null &&
    !isSyntheticMessageId(row.messageIdRaw) &&
    ingestionEnabled &&
    isAdmin;

  return {
    id: Number(row.id),
    messageIdRaw: row.messageIdRaw,
    fromAddress: row.fromAddress,
    subject: row.subject,
    sentAtLabel: row.sentAt ? formatPeruDateTime(row.sentAt) : null,
    receivedAtLabel: formatPeruDateTime(row.receivedAt),
    outcome: row.outcome,
    reason: row.reason,
    ticketId: row.ticketId === null ? null : Number(row.ticketId),
    attachmentCount: row.attachmentCount,
    attachmentNames: row.attachmentNames,
    retryable,
  };
}

/**
 * La pantalla de correo entrante (Task 9): la caja negra de la ingesta, para
 * el equipo interno. **No es una superficie de cliente** -- aquí se ven
 * direcciones y asuntos de todas las empresas a la vez, y por eso va bajo los
 * mismos dos guardas que el resto del panel (`tickets.controller.ts`,
 * `client-users.controller.ts`): `JwtAuthGuard` primero, `StaffOnlyGuard`
 * después como segunda barrera explícita contra un token de portal.
 *
 * `RolesGuard` se añade a la clase (tercero, como en `WorkspaceController`) y
 * no cambia nada para `list()`, que no lleva `@Roles(...)`: sin metadatos que
 * exigir, el guarda deja pasar a cualquier miembro del personal, igual que
 * antes. Solo `retry()` lo usa de verdad -- ver su comentario.
 */
@Controller('inbound-emails')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class InboundEmailController {
  constructor(
    private readonly repo: InboundEmailsRepository,
    private readonly service: InboundEmailService,
    private readonly workspace: WorkspaceService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('outcome') outcome?: string,
  ): Promise<InboundEmailListItem[]> {
    const filtro = this.parseOutcomeFilter(outcome);
    const [filas, ingestionEnabled] = await Promise.all([
      this.repo.list(filtro ? { outcome: filtro } : {}),
      this.workspace.isImapIngestionEnabled(),
    ]);
    const isAdmin = user.role === 'ADMIN';
    return filas.map((fila) => toInboundEmailListItem(fila, ingestionEnabled, isAdmin));
  }

  /**
   * **Tanda de cierre: `@Roles('ADMIN')` (con `RolesGuard` en la clase, ver
   * arriba).** La entrada de menú que lleva aquí ya era solo para ADMIN en el
   * frontend, pero el endpoint en sí aceptaba a cualquier miembro del
   * personal -- el frontend afirmaba una restricción que el backend no
   * imponía, el mismo patrón de control por rol que ya llevan todas las
   * mutaciones hermanas del panel (`WorkspaceController.update`,
   * `ClientUsersController`, ...).
   */
  @Post(':id/retry')
  @HttpCode(200)
  @Roles('ADMIN')
  async retry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<InboundEmailListItem> {
    const updated = await this.service.retry(id, user.email);
    const ingestionEnabled = await this.workspace.isImapIngestionEnabled();
    // Quien llega hasta aquí ya pasó `@Roles('ADMIN')`: `isAdmin` siempre es
    // `true` en este punto, pero se calcula igual (no se hardcodea) para que
    // la proyección devuelta sea consistente si algún día el guarda cambia.
    return toInboundEmailListItem(updated, ingestionEnabled, user.role === 'ADMIN');
  }

  /**
   * `undefined` es "sin filtro" (decisión explícita del querystring vacío);
   * cualquier otro valor tiene que ser uno de los `outcome` reales, nunca se
   * ignora en silencio -- un filtro mal escrito daría una lista vacía que
   * parecería "no hay nada", en vez de avisar de que el filtro mismo está mal.
   */
  private parseOutcomeFilter(outcome: string | undefined): InboundEmailOutcome | undefined {
    if (outcome === undefined) return undefined;
    if (!INBOUND_EMAIL_OUTCOMES.includes(outcome as InboundEmailOutcome)) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: `"${outcome}" no es un resultado válido para filtrar.`,
      });
    }
    return outcome as InboundEmailOutcome;
  }
}
