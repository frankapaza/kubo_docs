import { BadRequestException } from '@nestjs/common';
import { WorkspaceService, assertValidImapAuthServerId } from './workspace.service';

/**
 * Microsoft 365 no escribe ningún `authserv-id` al principio de su
 * `Authentication-Results` (empieza directo por `spf=pass ...`), así que con
 * `judgeAuthentication` fallando cerrado ese proveedor queda sin poder
 * ingerir correo. El rodeo obvio -- poner el propio nombre del método como
 * identificador -- reabre el vector que el ancla existe para detectar: una
 * cabecera fabricada por un atacante para su propio dominio también trae
 * `spf=pass`/`dkim=pass`, honesto para SU dominio. Estas pruebas cubren que
 * ese ajuste se rechaza al guardarlo, no solo que se documenta como mala
 * idea.
 */
describe('assertValidImapAuthServerId', () => {
  it('acepta un hostname normal', () => {
    expect(() => assertValidImapAuthServerId('mx.kuboti.com')).not.toThrow();
  });

  it('rechaza un identificador con "="', () => {
    expect(() => assertValidImapAuthServerId('spf=pass')).toThrow(BadRequestException);
  });

  it('rechaza "dkim=pass" igual que "spf=pass"', () => {
    expect(() => assertValidImapAuthServerId('dkim=pass')).toThrow(BadRequestException);
  });

  it('rechaza el nombre desnudo de un método de autenticación, sin "="', () => {
    // El rodeo sin `=`: si el servidor separa clave y valor con espacios
    // ("spf = pass ..."), extractServerId toma solo "spf" como primer token.
    expect(() => assertValidImapAuthServerId('spf')).toThrow(BadRequestException);
    expect(() => assertValidImapAuthServerId('dkim')).toThrow(BadRequestException);
    expect(() => assertValidImapAuthServerId('dmarc')).toThrow(BadRequestException);
  });

  it('la comprobación del nombre de método no distingue mayúsculas', () => {
    expect(() => assertValidImapAuthServerId('SPF')).toThrow(BadRequestException);
  });

  it('no rechaza un hostname que solo contiene la palabra como subcadena', () => {
    // "spf" es un método; un hostname real que la contenga sin ser
    // exactamente esa palabra no debe caer en el mismo rechazo.
    expect(() => assertValidImapAuthServerId('spf-relay.kuboti.com')).not.toThrow();
  });
});

describe('WorkspaceService.update -- validación de imapAuthServerId', () => {
  const makeService = () => {
    const row = { id: 1, imapAuthServerId: null };
    const repo = {
      findOne: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const service = new WorkspaceService(repo as any);
    return { service, repo };
  };

  it('rechaza guardar "spf=pass" como identificador de servidor', async () => {
    const { service, repo } = makeService();
    await expect(service.update({ imapAuthServerId: 'spf=pass' } as any)).rejects.toThrow(
      BadRequestException,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rechaza guardar "dkim" a secas como identificador de servidor', async () => {
    const { service, repo } = makeService();
    await expect(service.update({ imapAuthServerId: 'dkim' } as any)).rejects.toThrow(
      BadRequestException,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('permite guardar un hostname real', async () => {
    const { service, repo } = makeService();
    await service.update({ imapAuthServerId: 'mx.kuboti.com' } as any);
    expect(repo.update).toHaveBeenCalledWith(1, expect.objectContaining({ imapAuthServerId: 'mx.kuboti.com' }));
  });

  it('permite vaciar el ajuste (cadena vacía) sin pasar por la validación', async () => {
    const { service, repo } = makeService();
    await service.update({ imapAuthServerId: '' } as any);
    expect(repo.update).toHaveBeenCalledWith(1, expect.objectContaining({ imapAuthServerId: null }));
  });
});
