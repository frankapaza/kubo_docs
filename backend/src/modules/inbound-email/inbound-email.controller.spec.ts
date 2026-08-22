import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { InboundEmailController, toInboundEmailListItem } from './inbound-email.controller';
import { InboundEmail } from './entities/inbound-email.entity';

const TECNICO = { id: 7, email: 'tecnico@kuboti.com', role: 'DEVELOPER' };
const ADMIN = { id: 9, email: 'admin@kuboti.com', role: 'ADMIN' };

function unaFila(overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    id: 55,
    messageId: '<falla@empresa.com>',
    messageIdRaw: '<falla@empresa.com>',
    fromAddress: 'ana@empresa.com',
    subject: 'No carga el reporte',
    sentAt: new Date('2026-08-20T15:00:00Z'),
    receivedAt: new Date('2026-08-20T15:05:00Z'),
    outcome: 'ERROR',
    reason: 'Fallo de red al escribir el ticket.',
    ticketId: null,
    clientUserId: 11,
    attachmentCount: 0,
    attachmentNames: null,
    createdAt: new Date('2026-08-20T15:05:00Z'),
    ...overrides,
  };
}

/** Dobles mínimos de las tres dependencias, cada método un `jest.fn` propio. */
function makeController() {
  const repo = { list: jest.fn(), findById: jest.fn() };
  const service = { retry: jest.fn() };
  const workspace = { isImapIngestionEnabled: jest.fn().mockResolvedValue(true) };
  const controller = new InboundEmailController(repo as any, service as any, workspace as any);
  return { controller, repo, service, workspace };
}

describe('toInboundEmailListItem — la proyección', () => {
  it('nunca expone messageId (el normalizado/interno), solo messageIdRaw', () => {
    const fila = unaFila({ messageId: '<hash-sintetico@buzon-imap.invalid>' });

    const item = toInboundEmailListItem(fila, true, true);

    expect(item).not.toHaveProperty('messageId');
    expect(item.messageIdRaw).toBe('<falla@empresa.com>');
  });

  it('no expone clientUserId: fromAddress ya identifica a quién escribió', () => {
    const item = toInboundEmailListItem(unaFila(), true, true);

    expect(item).not.toHaveProperty('clientUserId');
  });

  it('formatea receivedAt en hora de Perú, con la zona nombrada', () => {
    // 2026-08-20T15:05:00Z son las 10:05 a. m. en Lima (UTC-5).
    const item = toInboundEmailListItem(unaFila(), true, true);

    expect(item.receivedAtLabel).toContain('hora de Perú');
    expect(item.receivedAtLabel).toMatch(/10:05/);
  });

  it('sentAt ausente (null) da sentAtLabel null, no una etiqueta inventada', () => {
    const item = toInboundEmailListItem(unaFila({ sentAt: null }), true, true);

    expect(item.sentAtLabel).toBeNull();
  });

  it('retryable es true solo para ERROR (con las otras cuatro guardas satisfechas)', () => {
    expect(toInboundEmailListItem(unaFila({ outcome: 'ERROR' }), true, true).retryable).toBe(true);
    expect(toInboundEmailListItem(unaFila({ outcome: 'TICKET_CREADO' }), true, true).retryable).toBe(false);
    expect(toInboundEmailListItem(unaFila({ outcome: 'DESCARTADO_SIN_CONTENIDO' }), true, true).retryable).toBe(
      false,
    );
  });

  /**
   * Una fila `ERROR` que ya se reencoló antes lleva el sufijo de
   * `buildRequeuedMessageId` en su `messageId` interno -- su `outcome` no
   * cambia, así que sin esta condición el botón se seguiría ofreciendo para
   * siempre y un segundo clic reencolaría el mismo correo dos veces.
   */
  it('retryable es false para una fila ERROR que ya se reencoló antes', () => {
    const fila = unaFila({
      outcome: 'ERROR',
      messageId: '<falla@empresa.com>#reintento-55-1755882600000',
    });

    expect(toInboundEmailListItem(fila, true, true).retryable).toBe(false);
  });

  /**
   * Tanda de cierre: las tres guardas que faltaban. `InboundEmailService.retry`
   * las comprueba las cuatro antes de reencolar de verdad; antes de esta
   * corrección, `retryable` solo reflejaba la primera -- así que el botón se
   * ofrecía para filas que el propio servicio iba a rechazar siempre.
   */
  it('retryable es false si la fila ya tiene un ticket asociado (podría duplicar un mensaje)', () => {
    const fila = unaFila({ outcome: 'ERROR', ticketId: 501 });

    expect(toInboundEmailListItem(fila, true, true).retryable).toBe(false);
  });

  it('retryable es false sin un Message-ID propio (null, o un sustituto sintético)', () => {
    expect(toInboundEmailListItem(unaFila({ outcome: 'ERROR', messageIdRaw: null }), true, true).retryable).toBe(
      false,
    );
    expect(
      toInboundEmailListItem(
        unaFila({ outcome: 'ERROR', messageIdRaw: '<sin-message-id.abc123@buzon-imap.invalid>' }),
        true,
        true,
      ).retryable,
    ).toBe(false);
  });

  it('retryable es false con la ingesta apagada, aunque el resto de guardas pasen', () => {
    expect(toInboundEmailListItem(unaFila({ outcome: 'ERROR' }), false, true).retryable).toBe(false);
  });

  /**
   * Corrección posterior a la tanda de cierre: `POST :id/retry` exige
   * `@Roles('ADMIN')`, pero esta pantalla no está protegida por rol -- solo
   * la entrada del menú lo está, en el frontend. Sin esta guarda, un
   * miembro del personal sin ese rol veía el botón igual que un ADMIN y su
   * clic devolvía un 403: un clic sin salida, la misma clase de fallo que
   * ya cubre la guarda de la ingesta apagada, ahora por rol.
   */
  it('retryable es false para quien no es ADMIN, aunque el resto de guardas pasen', () => {
    expect(toInboundEmailListItem(unaFila({ outcome: 'ERROR' }), true, false).retryable).toBe(false);
  });

  it('conserva el motivo y el ticket, campo a campo', () => {
    const item = toInboundEmailListItem(unaFila({ ticketId: 501 }), true, true);

    expect(item.reason).toBe('Fallo de red al escribir el ticket.');
    expect(item.ticketId).toBe(501);
  });
});

describe('InboundEmailController — guards', () => {
  it('lleva JwtAuthGuard, StaffOnlyGuard y RolesGuard: esta pantalla ve direcciones y asuntos de todas las empresas', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, InboundEmailController);

    expect(guards).toEqual([JwtAuthGuard, StaffOnlyGuard, RolesGuard]);
  });

  /**
   * El crítico de la tanda de cierre: la entrada de menú que lleva a esta
   * pantalla ya era solo para ADMIN en el frontend, pero el endpoint de
   * reintento aceptaba a cualquier miembro del personal -- el frontend
   * afirmaba una restricción que el backend no imponía.
   */
  it('retry() exige el rol ADMIN', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, InboundEmailController.prototype.retry);

    expect(roles).toEqual(['ADMIN']);
  });

  it('list() no exige ningún rol -- cualquier miembro del personal puede consultar el listado', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, InboundEmailController.prototype.list);

    expect(roles).toBeUndefined();
  });
});

describe('InboundEmailController.list', () => {
  it('sin outcome, pide el listado sin filtro', async () => {
    const { controller, repo } = makeController();
    repo.list.mockResolvedValue([unaFila()]);

    const resultado = await controller.list(ADMIN as any, undefined);

    expect(repo.list).toHaveBeenCalledWith({});
    expect(resultado).toHaveLength(1);
    expect(resultado[0].id).toBe(55);
  });

  it('con outcome válido, lo pasa como filtro', async () => {
    const { controller, repo } = makeController();
    repo.list.mockResolvedValue([]);

    await controller.list(ADMIN as any, 'ERROR');

    expect(repo.list).toHaveBeenCalledWith({ outcome: 'ERROR' });
  });

  /**
   * Un filtro mal escrito no debe dar una lista vacía en silencio -- eso
   * parecería "no hay nada" cuando en realidad el filtro mismo está mal. Se
   * decide por el hecho (¿es uno de los `outcome` reales?), nunca se ignora.
   */
  it('con un outcome que no existe, rechaza en vez de devolver una lista vacía', async () => {
    const { controller, repo } = makeController();

    await expect(controller.list(ADMIN as any, 'NO_EXISTE')).rejects.toThrow(BadRequestException);
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('con la ingesta apagada, ninguna fila en error se ofrece como reintentable', async () => {
    const { controller, repo, workspace } = makeController();
    repo.list.mockResolvedValue([unaFila({ outcome: 'ERROR' })]);
    workspace.isImapIngestionEnabled.mockResolvedValue(false);

    const resultado = await controller.list(ADMIN as any, undefined);

    expect(resultado[0].retryable).toBe(false);
  });

  /**
   * Corrección posterior a la tanda de cierre: `list()` no lleva
   * `@Roles(...)` -- cualquier miembro del personal puede CONSULTAR el
   * listado -- pero el cálculo de `retryable` de cada fila sí tiene que
   * reflejar el rol de quien pregunta, porque solo un ADMIN puede de verdad
   * reencolar.
   */
  it('con un usuario que no es ADMIN, ninguna fila en error se ofrece como reintentable', async () => {
    const { controller, repo } = makeController();
    repo.list.mockResolvedValue([unaFila({ outcome: 'ERROR' })]);

    const resultado = await controller.list(TECNICO as any, undefined);

    expect(resultado[0].retryable).toBe(false);
  });

  it('con un usuario ADMIN, una fila en error elegible sí se ofrece como reintentable', async () => {
    const { controller, repo } = makeController();
    repo.list.mockResolvedValue([unaFila({ outcome: 'ERROR' })]);

    const resultado = await controller.list(ADMIN as any, undefined);

    expect(resultado[0].retryable).toBe(true);
  });
});

describe('InboundEmailController.retry', () => {
  it('delega en el servicio con el id y el correo de quien reintenta, y proyecta el resultado', async () => {
    const { controller, service } = makeController();
    service.retry.mockResolvedValue(unaFila({ reason: 'Reencolado el 20 de agosto de 2026, 10:10 a. m. (hora de Perú) por tecnico@kuboti.com para volver a procesarse.' }));

    const resultado = await controller.retry(TECNICO as any, 55);

    expect(service.retry).toHaveBeenCalledWith(55, 'tecnico@kuboti.com');
    expect(resultado.id).toBe(55);
    expect(resultado.reason).toContain('Reencolado el');
  });

  it('un fallo del servicio (fila no encontrada, no está en ERROR, no se pudo reencolar) sube tal cual', async () => {
    const { controller, service } = makeController();
    service.retry.mockRejectedValue(new BadRequestException({ code: 'CONFLICT', message: 'no se puede' }));

    await expect(controller.retry(TECNICO as any, 999)).rejects.toThrow(BadRequestException);
  });
});
