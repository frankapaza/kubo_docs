import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InboundEmail } from './entities/inbound-email.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketEvent } from '../tickets/entities/ticket-event.entity';

import { InboundEmailsRepository } from './inbound-emails.repository';
import { INBOUND_MAILBOX_ADDRESS, InboundEmailService } from './inbound-email.service';
import { InboundEmailScheduler } from './inbound-email.scheduler';
import { ImapMailboxService } from './imap-mailbox.service';
import { MAILBOX } from './mailbox.interface';
import { extractSenderAddress } from './domain/message-headers';

import { WorkspaceService } from '../workspace/workspace.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { EmailModule } from '../email/email.module';
import { UsersModule } from '../users/users.module';
import { PortalModule } from '../portal/portal.module';
import { TicketsModule } from '../tickets/tickets.module';
import { TicketMessagesModule } from '../ticket-messages/ticket-messages.module';

/**
 * El buzón IMAP real, la configuración y el reloj (Task 8): el módulo que por
 * fin monta `InboundEmailService` (Task 6-7, hasta ahora solo probado con un
 * doble de `Mailbox`) contra un buzón de verdad.
 *
 * `TypeOrmModule.forFeature([InboundEmail, Ticket, TicketEvent])` repite el
 * registro de `Ticket`/`TicketEvent` que ya hace `TicketsModule`: es a
 * propósito y no un descuido -- `InboundEmailsRepository` inyecta
 * `Repository<Ticket>` y `Repository<TicketEvent>` directamente (para
 * correlacionar por `email_message_id`/`sent_message_id` sin pasar por
 * `TicketsRepository`), y `TicketsModule` no exporta `TypeOrmModule` para que
 * otros módulos reutilicen esos repositorios crudos. Dos módulos registrando
 * la misma entidad con TypeORM es soportado y habitual en este patrón: ambos
 * obtienen su propio proveedor `Repository<T>` sobre la misma conexión y la
 * misma tabla, sin conflicto.
 *
 * `PortalModule` se importa entero solo por `ClientUsersService` (que ahora
 * exporta, ver su propio comentario) -- igual que `TicketMessagesModule` ya
 * importa `TicketsModule` entero por unos pocos exports.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([InboundEmail, Ticket, TicketEvent]),
    WorkspaceModule,
    EmailModule,
    UsersModule,
    PortalModule,
    TicketsModule,
    TicketMessagesModule,
  ],
  providers: [
    InboundEmailsRepository,
    InboundEmailService,
    InboundEmailScheduler,
    // Un solo proveedor para `ImapMailboxService`, bajo el token `MAILBOX`:
    // listarla TAMBIÉN suelta (`ImapMailboxService` a secas) crearía una
    // segunda instancia con su propia sesión IMAP, sin que nadie la use --
    // nada en este módulo la inyecta por su propia clase, solo por `MAILBOX`.
    { provide: MAILBOX, useClass: ImapMailboxService },
    {
      provide: INBOUND_MAILBOX_ADDRESS,
      inject: [WorkspaceService],
      /**
       * Se resuelve **una vez**, al arrancar: `INBOUND_MAILBOX_ADDRESS` es un
       * `string` plano por contrato (ver su comentario en
       * `inbound-email.service.ts`), no una promesa que se vuelva a
       * consultar en cada correo -- a diferencia de `ImapMailboxService`, que
       * sí relee la configuración en cada (re)conexión. Si el usuario IMAP
       * cambia más tarde desde los ajustes, esta dirección necesita un
       * reinicio del backend para actualizarse; el propio buzón (host,
       * puerto, credenciales) no lo necesita. Documentado también en el
       * informe de esta tarea.
       *
       * Vacía (`''`) si el buzón todavía no está configurado: `isOwnMailbox`
       * nunca compara igual contra una cadena vacía (ninguna dirección real lo
       * es), así que degrada a "nunca es el propio buzón" -- el lado seguro,
       * nunca a "todo correo es el propio buzón".
       */
      useFactory: async (workspace: WorkspaceService): Promise<string> => {
        const config = await workspace.getImapConfig();
        return config ? extractSenderAddress(config.user) : '';
      },
    },
  ],
  exports: [InboundEmailService],
})
export class InboundEmailModule {}
