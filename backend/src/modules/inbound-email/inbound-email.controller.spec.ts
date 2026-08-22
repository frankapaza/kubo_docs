import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { InboundEmailController, toInboundEmailListItem } from './inbound-email.controller';
import { InboundEmail } from './entities/inbound-email.entity';

const TECNICO = { id: 7, email: 'tecnico@kuboti.com', role: 'DEVELOPER' };

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

/** Dobles mínimos de las dos dependencias, cada método un `jest.fn` propio. */
function makeController() {
  const repo = { list: jest.fn(), findById: jest.fn() };
  const service = { retry: jest.fn() };
  const controller = new InboundEmailController(repo as any, service as any);
  return { controller, repo, service };
}

describe('toInboundEmailListItem — la proyección', () => {
  it('nunca expone messageId (el normalizado/interno), solo messageIdRaw', () => {
    const fila = unaFila({ messageId: '<hash-sintetico@buzon-imap.invalid>' });

    const item = toInboundEmailListItem(fila);

    expect(item).not.toHaveProperty('messageId');
    expect(item.messageIdRaw).toBe('<falla@empresa.com>');
  });

  it('no expone clientUserId: fromAddress ya identifica a quién escribió', () => {
    const item = toInboundEmailListItem(unaFila());

    expect(item).not.toHaveProperty('clientUserId');
  });

  it('formatea receivedAt en hora de Perú, con la zona nombrada', () => {
    // 2026-08-20T15:05:00Z son las 10:05 a. m. en Lima (UTC-5).
    const item = toInboundEmailListItem(unaFila());

    expect(item.receivedAtLabel).toContain('hora de Perú');
    expect(item.receivedAtLabel).toMatch(/10:05/);
  });

  it('sentAt ausente (null) da sentAtLabel null, no una etiqueta inventada', () => {
    const item = toInboundEmailListItem(unaFila({ sentAt: null }));

    expect(item.sentAtLabel).toBeNull();
  });

  it('retryable es true solo para ERROR', () => {
    expect(toInboundEmailListItem(unaFila({ outcome: 'ERROR' })).retryable).toBe(true);
    expect(toInboundEmailListItem(unaFila({ outcome: 'TICKET_CREADO' })).retryable).toBe(false);
    expect(toInboundEmailListItem(unaFila({ outcome: 'DESCARTADO_SIN_CONTENIDO' })).retryable).toBe(false);
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

    expect(toInboundEmailListItem(fila).retryable).toBe(false);
  });

  it('conserva el motivo y el ticket, campo a campo', () => {
    const item = toInboundEmailListItem(unaFila({ ticketId: 501 }));

    expect(item.reason).toBe('Fallo de red al escribir el ticket.');
    expect(item.ticketId).toBe(501);
  });
});

describe('InboundEmailController — guards', () => {
  it('lleva JwtAuthGuard y StaffOnlyGuard: esta pantalla ve direcciones y asuntos de todas las empresas', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, InboundEmailController);

    expect(guards).toEqual([JwtAuthGuard, StaffOnlyGuard]);
  });
});

describe('InboundEmailController.list', () => {
  it('sin outcome, pide el listado sin filtro', async () => {
    const { controller, repo } = makeController();
    repo.list.mockResolvedValue([unaFila()]);

    const resultado = await controller.list(undefined);

    expect(repo.list).toHaveBeenCalledWith({});
    expect(resultado).toHaveLength(1);
    expect(resultado[0].id).toBe(55);
  });

  it('con outcome válido, lo pasa como filtro', async () => {
    const { controller, repo } = makeController();
    repo.list.mockResolvedValue([]);

    await controller.list('ERROR');

    expect(repo.list).toHaveBeenCalledWith({ outcome: 'ERROR' });
  });

  /**
   * Un filtro mal escrito no debe dar una lista vacía en silencio -- eso
   * parecería "no hay nada" cuando en realidad el filtro mismo está mal. Se
   * decide por el hecho (¿es uno de los `outcome` reales?), nunca se ignora.
   */
  it('con un outcome que no existe, rechaza en vez de devolver una lista vacía', async () => {
    const { controller, repo } = makeController();

    await expect(controller.list('NO_EXISTE')).rejects.toThrow(BadRequestException);
    expect(repo.list).not.toHaveBeenCalled();
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
