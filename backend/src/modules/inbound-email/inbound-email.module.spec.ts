import { Test } from '@nestjs/testing';

import { resolveMailboxAddress } from './inbound-email.module';
import { INBOUND_MAILBOX_ADDRESS } from './inbound-email.service';
import { WorkspaceService } from '../workspace/workspace.service';

/**
 * El crítico de la ronda de correcciones 1: la primera versión de
 * `INBOUND_MAILBOX_ADDRESS` era un `useFactory` que llamaba a
 * `WorkspaceService.getImapConfig()` sin red de seguridad propia. Un
 * proveedor `useFactory` async se resuelve **durante la instanciación del
 * árbol de proveedores**, antes de que corra ningún `onApplicationBootstrap`
 * -- en particular, antes de `PortalSchemaValidator`, que es quien sabe
 * explicar con un mensaje legible que falta la migración 023 o la fila de
 * ajustes. Si esa lectura reventaba (base sin fila, migración 023 sin
 * aplicar), Nest abortaba el arranque con el error crudo de MySQL/TypeORM
 * **tapando** ese mensaje amable -- y lo hacía incluso con el interruptor de
 * la ingesta apagado, justo el escenario que "nace apagada" promete no tocar.
 *
 * Dos capas de prueba, no una:
 *  1. `resolveMailboxAddress` como función suelta, contra los tres estados de
 *     `WorkspaceService.getImapConfig()` que puede dar una base real: sin
 *     fila (`null`), rota (rechaza la promesa) y configurada del todo.
 *  2. Un `Test.createTestingModule` que compila el **mismo** proveedor que
 *     usa `InboundEmailModule` -- no una reimplementación aparte, que podría
 *     divergir sin que nada avisara -- contra los mismos tres estados, para
 *     probar de verdad que el contenedor de Nest instancia el árbol sin
 *     abortar. Se hace con un módulo mínimo (`WorkspaceService` doblado, sin
 *     `TypeOrmModule`) y no con `InboundEmailModule` completo: ese módulo
 *     arrastra transitivamente TypeORM, BullMQ y colas de Redis a través de
 *     `TicketsModule`/`PortalModule`/`TicketMessagesModule`, y montarlo de
 *     verdad exigiría doblar una docena de dependencias que no tienen nada
 *     que ver con este proveedor -- ver `storage.module.spec.ts` para lo
 *     pesado que es ese camino incluso para un solo módulo. El proveedor que
 *     de verdad puede tumbar el arranque es autocontenido (`WorkspaceService`
 *     adentro, un `string` afuera), y es exactamente lo que se aísla aquí.
 */
describe('resolveMailboxAddress', () => {
  it('el buzón no tiene fila de ajustes (getImapConfig resuelve null): no revienta, da cadena vacía', async () => {
    const workspace = { getImapConfig: jest.fn().mockResolvedValue(null) };

    await expect(resolveMailboxAddress(workspace as any)).resolves.toBe('');
  });

  it('la consulta revienta (p. ej. falta la migración 023): no revienta, da cadena vacía', async () => {
    const workspace = {
      getImapConfig: jest.fn().mockRejectedValue(new Error("Unknown column 'imap_host' in 'field list'")),
    };

    await expect(resolveMailboxAddress(workspace as any)).resolves.toBe('');
  });

  it('el buzón está configurado del todo: da la dirección del usuario IMAP, ya normalizada', async () => {
    const workspace = {
      getImapConfig: jest.fn().mockResolvedValue({
        host: 'imap.kuboti.com',
        port: 993,
        secure: true,
        user: 'Ticket@Kuboti.com',
        pass: 'secreto',
        folder: 'INBOX',
      }),
    };

    await expect(resolveMailboxAddress(workspace as any)).resolves.toBe('ticket@kuboti.com');
  });

  /**
   * Residuo de la tanda de cierre: `InboundEmailService.withNormalizedFrom`
   * reescribe SIEMPRE el dominio de `message.from` a su forma codificada
   * (`withEncodedDomain`) antes de que `isOwnMailbox` lo compare contra este
   * valor -- si este lado se quedara sin la misma reescritura, un buzón de
   * ingesta en un dominio internacionalizado nunca se reconocería a sí mismo,
   * y un acuse propio que vuelve a entrar dejaría de descartarse en silencio.
   */
  it('el usuario IMAP en un dominio internacionalizado se normaliza a su forma codificada', async () => {
    const workspace = {
      getImapConfig: jest.fn().mockResolvedValue({
        host: 'imap.kuboti.com',
        port: 993,
        secure: true,
        user: 'Ticket@пример.com',
        pass: 'secreto',
        folder: 'INBOX',
      }),
    };

    await expect(resolveMailboxAddress(workspace as any)).resolves.toBe('ticket@xn--e1afmkfd.com');
  });
});

describe('el proveedor INBOUND_MAILBOX_ADDRESS se instancia sin abortar el arranque', () => {
  /** El mismo proveedor que declara `InboundEmailModule`, para no divergir. */
  const proveedorDireccion = {
    provide: INBOUND_MAILBOX_ADDRESS,
    inject: [WorkspaceService],
    useFactory: resolveMailboxAddress,
  };

  it('con la base sin la fila de ajustes', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: WorkspaceService, useValue: { getImapConfig: jest.fn().mockResolvedValue(null) } },
        proveedorDireccion,
      ],
    }).compile();

    expect(moduleRef.get(INBOUND_MAILBOX_ADDRESS)).toBe('');
    await moduleRef.close();
  });

  it('con la migración 023 sin aplicar (la consulta revienta)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: WorkspaceService,
          useValue: {
            getImapConfig: jest.fn().mockRejectedValue(new Error('ER_BAD_FIELD_ERROR: imap_host')),
          },
        },
        proveedorDireccion,
      ],
    }).compile();

    expect(moduleRef.get(INBOUND_MAILBOX_ADDRESS)).toBe('');
    await moduleRef.close();
  });

  it('con el buzón configurado del todo', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: WorkspaceService,
          useValue: {
            getImapConfig: jest.fn().mockResolvedValue({
              host: 'imap.kuboti.com',
              port: 993,
              secure: true,
              user: 'ticket@kuboti.com',
              pass: 'secreto',
              folder: 'INBOX',
            }),
          },
        },
        proveedorDireccion,
      ],
    }).compile();

    expect(moduleRef.get(INBOUND_MAILBOX_ADDRESS)).toBe('ticket@kuboti.com');
    await moduleRef.close();
  });
});
