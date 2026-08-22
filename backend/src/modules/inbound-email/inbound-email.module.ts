import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InboundEmail } from './entities/inbound-email.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketEvent } from '../tickets/entities/ticket-event.entity';

import { InboundEmailsRepository } from './inbound-emails.repository';
import { INBOUND_MAILBOX_ADDRESS, InboundEmailService } from './inbound-email.service';
import { InboundEmailController } from './inbound-email.controller';
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
 * La dirección del propio buzón, para el proveedor `INBOUND_MAILBOX_ADDRESS`.
 * Función libre y exportada -- no una función anónima dentro de `useFactory`
 * -- por dos motivos: se puede probar sin compilar ningún módulo de Nest
 * (`inbound-email.module.spec.ts`), y así queda claro que su firma es
 * exactamente la que Nest invoca al resolver el proveedor.
 *
 * Se resuelve **una vez**, al arrancar: `INBOUND_MAILBOX_ADDRESS` es un
 * `string` plano por contrato (ver su comentario en `inbound-email.service.ts`),
 * no una promesa que se vuelva a consultar en cada correo -- a diferencia de
 * `ImapMailboxService`, que sí relee la configuración en cada (re)conexión.
 * Si el usuario IMAP cambia más tarde desde los ajustes, esta dirección
 * necesita un reinicio del backend para actualizarse; el propio buzón (host,
 * puerto, credenciales) no lo necesita. Documentado también en el informe de
 * la Task 8.
 *
 * **Nunca deja escapar una excepción -- ronda de correcciones 1, el otro
 * crítico de esta tarea.** Un proveedor de Nest con `useFactory` async se
 * resuelve durante la instanciación del árbol de proveedores, **antes** de
 * que corra ningún `onApplicationBootstrap` -- en particular, antes de
 * `PortalSchemaValidator`, que es quien sabe explicar con un mensaje legible
 * que falta la migración 023 o la fila de ajustes. Si esta función dejara
 * escapar el error de `WorkspaceService.getImapConfig()` (que ya se blinda
 * él solo, pero no hay que confiar en eso desde aquí también, por si algún
 * día deja de ser cierto), Nest abortaría el arranque con la excepción cruda
 * de TypeORM/MySQL, tapando ese mensaje -- y lo haría **incluso con el
 * interruptor de la ingesta apagado**, que es exactamente el escenario que
 * "nace apagada" promete no tocar nada. Cualquier fallo aquí degrada a `''`:
 * mismo valor, mismo efecto seguro, que "el buzón no está configurado
 * todavía" (ver más abajo).
 *
 * Vacía (`''`) si el buzón no está configurado, o si algo revienta al
 * consultarlo: `isOwnMailbox` nunca compara igual contra una cadena vacía
 * (ninguna dirección real lo es), así que degrada a "nunca es el propio
 * buzón" -- el lado seguro, nunca a "todo correo es el propio buzón".
 *
 * **Limitación conocida, anotada para la lista de puesta en marcha**: esta
 * dirección sale del **usuario IMAP** de autenticación, no de un campo
 * aparte. Si ese usuario no es en sí mismo una dirección de correo (algunos
 * servidores autentican con un nombre de cuenta que no lo es), esta función
 * devuelve igualmente ese valor tal cual -- `extractSenderAddress` no lo
 * rechaza, solo lo recorta y lo pone en minúsculas -- y `isOwnMailbox` nunca
 * podrá compararlo con éxito contra un `From` real: la guarda contra el
 * propio eco del sistema queda apagada en silencio, aunque el resto de la
 * ingesta funcione con normalidad.
 */
export async function resolveMailboxAddress(workspace: WorkspaceService): Promise<string> {
  try {
    const config = await workspace.getImapConfig();
    return config ? extractSenderAddress(config.user) : '';
  } catch {
    return '';
  }
}

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
  controllers: [InboundEmailController],
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
      useFactory: resolveMailboxAddress,
    },
  ],
  exports: [InboundEmailService],
})
export class InboundEmailModule {}
