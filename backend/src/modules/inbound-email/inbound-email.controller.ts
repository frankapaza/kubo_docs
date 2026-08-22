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
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { formatPeruDateTime } from '../../common/peru-date-time';

import { InboundEmailsRepository } from './inbound-emails.repository';
import { InboundEmailService } from './inbound-email.service';
import { isRequeuedMessageId } from './domain/retry';
import { INBOUND_EMAIL_OUTCOMES, InboundEmail, InboundEmailOutcome } from './entities/inbound-email.entity';

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
 * `retryable` exige `outcome === 'ERROR'` **y** que la fila no se haya
 * reencolado ya (`isRequeuedMessageId`, sobre el `messageId` interno --
 * nunca expuesto, ver el comentario de `InboundEmailListItem` arriba). Sin
 * la segunda condición, una fila ya reencolada seguiría ofreciendo el botón
 * para siempre (su `outcome` se queda en `ERROR` a propósito, como rastro
 * histórico -- ver `domain/retry.ts`), y un segundo clic reencolaría el
 * mismo correo una segunda vez.
 */
export function toInboundEmailListItem(row: InboundEmail): InboundEmailListItem {
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
    retryable: row.outcome === 'ERROR' && !isRequeuedMessageId(row.messageId),
  };
}

/**
 * La pantalla de correo entrante (Task 9): la caja negra de la ingesta, para
 * el equipo interno. **No es una superficie de cliente** -- aquí se ven
 * direcciones y asuntos de todas las empresas a la vez, y por eso va bajo los
 * mismos dos guardas que el resto del panel (`tickets.controller.ts`,
 * `client-users.controller.ts`): `JwtAuthGuard` primero, `StaffOnlyGuard`
 * después como segunda barrera explícita contra un token de portal.
 */
@Controller('inbound-emails')
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class InboundEmailController {
  constructor(
    private readonly repo: InboundEmailsRepository,
    private readonly service: InboundEmailService,
  ) {}

  @Get()
  async list(@Query('outcome') outcome?: string): Promise<InboundEmailListItem[]> {
    const filtro = this.parseOutcomeFilter(outcome);
    const filas = await this.repo.list(filtro ? { outcome: filtro } : {});
    return filas.map(toInboundEmailListItem);
  }

  @Post(':id/retry')
  @HttpCode(200)
  async retry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<InboundEmailListItem> {
    const updated = await this.service.retry(id, user.email);
    return toInboundEmailListItem(updated);
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
