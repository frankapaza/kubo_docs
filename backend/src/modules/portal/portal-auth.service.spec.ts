import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PortalAuthService } from './portal-auth.service';

// bcrypt es un addon nativo: sus propiedades no son configurables, así que
// `jest.spyOn(bcrypt, 'compare')` falla con "Cannot redefine property".
// Se envuelve `compare` en un jest.fn que delega en la implementación real,
// para poder comprobar que se invoca sin perder su comportamiento genuino.
jest.mock('bcrypt', () => {
  const actual = jest.requireActual('bcrypt');
  return { ...actual, compare: jest.fn(actual.compare) };
});

const makeService = (user: unknown, client: unknown = { id: 7, razonSocial: 'Cliente de Prueba SAC' }) => {
  const repo = {
    findByEmail: jest.fn().mockResolvedValue(user),
    findById: jest.fn().mockResolvedValue(user),
    touchLastLogin: jest.fn().mockResolvedValue(undefined),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('tok'), verifyAsync: jest.fn() };
  const cfg = { get: jest.fn().mockReturnValue('secreto') };
  const clients = {
    findByIdOrFail: client
      ? jest.fn().mockResolvedValue(client)
      : jest.fn().mockRejectedValue(new NotFoundException('Cliente no encontrado')),
  };
  return {
    service: new PortalAuthService(repo as any, jwt as any, cfg as any, clients as any),
    repo,
    jwt,
    clients,
  };
};

describe('login', () => {
  it('rechaza un correo que no existe', async () => {
    const { service } = makeService(null);
    await expect(service.login('nadie@x.com', 'x')).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza una contrasena incorrecta', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    await expect(service.login('a@x.com', 'incorrecta')).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza a un usuario desactivado aunque la contrasena sea correcta', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 0, isAdmin: 0 });
    await expect(service.login('a@x.com', 'correcta')).rejects.toThrow(UnauthorizedException);
  });

  it('devuelve el mismo error para correo inexistente y contrasena mala', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const a = makeService(null);
    const b = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    const errA = await a.service.login('nadie@x.com', 'x').catch((e: any) => e.message);
    const errB = await b.service.login('a@x.com', 'mala').catch((e: any) => e.message);
    expect(errA).toBe(errB);
  });

  it('firma el token con el clientId del usuario, no con uno de fuera', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service, jwt } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    await service.login('a@x.com', 'correcta');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 1, clientId: 7, isClientAdmin: false }),
      expect.anything(),
    );
  });

  it('sella last_login_at al entrar', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service, repo } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    await service.login('a@x.com', 'correcta');
    expect(repo.touchLastLogin).toHaveBeenCalledWith(1);
  });

  it('invoca bcrypt.compare tambien cuando el correo no existe, para no filtrar por tiempo', async () => {
    (bcrypt.compare as jest.Mock).mockClear();
    const { service } = makeService(null);
    await service.login('nadie@x.com', 'x').catch(() => undefined);
    expect(bcrypt.compare).toHaveBeenCalled();
  });

  it('incluye la razon social del cliente en clientUser', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service, clients } = makeService(
      { id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 },
      { id: 7, razonSocial: 'Cliente de Prueba SAC', ruc: '20123456789', address: 'Av. Falsa 123' },
    );
    const res = await service.login('a@x.com', 'correcta');
    expect(res.clientUser.clientRazonSocial).toBe('Cliente de Prueba SAC');
    expect(clients.findByIdOrFail).toHaveBeenCalledWith(7);
  });

  it('no filtra ningun otro campo del cliente ademas de la razon social', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service } = makeService(
      { id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 },
      {
        id: 7,
        razonSocial: 'Cliente de Prueba SAC',
        ruc: '20123456789',
        address: 'Av. Falsa 123',
        contactEmail: 'facturacion@cliente.pe',
        legalRepDoc: '12345678',
      },
    );
    const res = await service.login('a@x.com', 'correcta');
    expect(Object.keys(res.clientUser).sort()).toEqual(
      ['clientId', 'clientRazonSocial', 'email', 'fullName', 'id', 'isAdmin'].sort(),
    );
  });

  it('la sesion dice si el usuario administra su empresa', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 1 });
    const res = await service.login('a@x.com', 'correcta');
    // Booleano, no el tinyint: el frontend hace `if (user.isAdmin)` y un 0
    // llegado como cadena '0' seria verdadero.
    expect(res.clientUser.isAdmin).toBe(true);
  });

  it('un usuario normal llega con isAdmin en false', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    const res = await service.login('a@x.com', 'correcta');
    expect(res.clientUser.isAdmin).toBe(false);
  });

  it('degrada a null si el cliente no se puede resolver, sin tumbar el login', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service } = makeService(
      { id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 },
      null,
    );
    const res = await service.login('a@x.com', 'correcta');
    expect(res.clientUser.clientRazonSocial).toBeNull();
  });

  it('deja subir un fallo de infraestructura al resolver el cliente, en vez de disfrazarlo de null', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service, clients } = makeService({
      id: 1,
      clientId: 7,
      email: 'a@x.com',
      passwordHash: hash,
      isActive: 1,
      isAdmin: 0,
    });
    const caida = new Error('ECONNREFUSED');
    clients.findByIdOrFail = jest.fn().mockRejectedValue(caida);
    await expect(service.login('a@x.com', 'correcta')).rejects.toThrow(caida);
  });
});

describe('refresh', () => {
  const hash$ = bcrypt.hash('correcta', 10);

  it('devuelve tambien la razon social del cliente al refrescar', async () => {
    const hash = await hash$;
    const user = { id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 };
    const { service, jwt } = makeService(user, { id: 7, razonSocial: 'Cliente de Prueba SAC' });
    jwt.verifyAsync = jest.fn().mockResolvedValue({ sub: 1, email: 'a@x.com', clientId: 7, isClientAdmin: false });
    const res = await service.refresh('un-refresh-token-valido');
    expect(res.clientUser.clientRazonSocial).toBe('Cliente de Prueba SAC');
  });

  it('rechaza un token de refresco invalido', async () => {
    const { service, jwt } = makeService(null);
    jwt.verifyAsync = jest.fn().mockRejectedValue(new Error('invalido'));
    await expect(service.refresh('lo-que-sea')).rejects.toThrow(UnauthorizedException);
  });

  /**
   * El 401 del refresco tiene un significado concreto aguas abajo: el
   * interceptor del frontend lo lee como "sesion muerta", borra las tres
   * claves y redirige al login. Si un fallo de infraestructura se disfrazara
   * de 401, un parpadeo de la base cerraria la sesion de todos los usuarios
   * del portal y la caida no apareceria como 5xx en ninguna metrica.
   */
  it('un fallo de infraestructura al resolver el cliente sube tal cual, no se convierte en 401', async () => {
    const hash = await hash$;
    const user = { id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 };
    const { service, jwt, clients } = makeService(user);
    jwt.verifyAsync = jest.fn().mockResolvedValue({ sub: 1, email: 'a@x.com', clientId: 7, isClientAdmin: false });
    const caida = new Error('ECONNREFUSED');
    clients.findByIdOrFail = jest.fn().mockRejectedValue(caida);

    await expect(service.refresh('un-refresh-token-valido')).rejects.toThrow(caida);
    await expect(service.refresh('un-refresh-token-valido')).rejects.not.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('un fallo de la base al buscar al usuario sube tal cual, no se convierte en 401', async () => {
    const { service, jwt, repo } = makeService(null);
    jwt.verifyAsync = jest.fn().mockResolvedValue({ sub: 1, email: 'a@x.com', clientId: 7, isClientAdmin: false });
    const caida = new Error('ER_LOCK_WAIT_TIMEOUT');
    repo.findById = jest.fn().mockRejectedValue(caida);

    await expect(service.refresh('un-refresh-token-valido')).rejects.toThrow(caida);
  });

  it('rechaza el refresco de un usuario desactivado', async () => {
    const hash = await hash$;
    const user = { id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 0, isAdmin: 0 };
    const { service, jwt } = makeService(user);
    jwt.verifyAsync = jest.fn().mockResolvedValue({ sub: 1, email: 'a@x.com', clientId: 7, isClientAdmin: false });
    await expect(service.refresh('un-refresh-token-valido')).rejects.toThrow(UnauthorizedException);
  });
});
