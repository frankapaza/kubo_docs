import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import {
  TICKET_MESSAGE_VISIBILITIES,
  TicketMessageVisibility,
} from '../entities/ticket-message.entity';

/**
 * `body_md` es `TEXT` en MySQL: 65.535 **bytes**, no caracteres. Un tope de
 * 16.000 caracteres cabe incluso si cada uno ocupa los 4 bytes del peor caso
 * (emoji en `utf8mb4`), así que ningún mensaje admitido aquí puede reventar
 * después con `ER_DATA_TOO_LONG` en el propio `INSERT`.
 */
const MAX_BODY_LENGTH = 16000;

/**
 * Un mensaje escrito desde la consola del equipo. Es el único DTO que declara
 * `visibility`, porque es el único autor que puede elegirla.
 */
export class CreateMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_BODY_LENGTH)
  bodyMd!: string;

  /** Sin valor explícito, `PUBLICA`: lo que el cliente verá en el portal. */
  @IsOptional()
  @IsIn(TICKET_MESSAGE_VISIBILITIES)
  visibility?: TicketMessageVisibility;
}

/**
 * Un mensaje escrito desde el portal del cliente. **No declara `visibility` a
 * propósito**: un cliente no puede escribir notas internas, y lo que no está
 * en el DTO no llega al servicio ni siquiera con `forbidNonWhitelisted`
 * apagado.
 *
 * Aun así, `TicketMessagesService.post` vuelve a forzar `PUBLICA` para todo
 * actor de cliente y no se fía de este DTO: esta clase es la primera puerta,
 * no la única. Una nota interna que acabe siendo visible en el portal es una
 * fuga que no se puede retirar, y no puede depender de que el controlador de
 * mañana siga eligiendo este DTO y no el de arriba.
 */
export class CreatePortalMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_BODY_LENGTH)
  bodyMd!: string;
}
