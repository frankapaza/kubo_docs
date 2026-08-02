import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryFailedError } from 'typeorm';

import { ClientUsersService } from './client-users.service';
import { UpdateClientUserDto } from './dto/client-user.dto';

/**
 * Un `QueryFailedError` tal como lo produce mysql2: `TypeORM` copia las
 * propiedades del error del driver (`code`, `errno`, `sqlMessage`...) sobre
 * la propia excepción, así que basta con dárselas al `driverError` de
 * mentira para que el objeto resultante sea indistinguible del real a
 * efectos de `isDuplicateEntryError`.
 */
const makeQueryFailedError = (code: string, message: string): QueryFailedError => {
  const driverError = Object.assign(new Error(message), { code, errno: 1062 });
  return new QueryFailedError('INSERT INTO client_users ...', [], driverError);
};

/** El cliente 1 sembrado en desarrollo, con su usuario de control ya de alta. */
const CLIENT = { id: 1, razonSocial: 'Cliente Prueba SAC' };

/**
 * Doble del repositorio que replica la única pieza de lógica que importa para
 * estos tests: `findByEmail`/`create`/`update` normalizan el correo, igual
 * que hace `ClientUsersRepository` de verdad. Con un doble que ignorase eso,
 * las aserciones sobre duplicados por mayúsculas no probarían nada real.
 */
const normalize = (email: string) => email.trim().toLowerCase();

const makeService = () => {
  const almacen: any[] = [
    {
      id: 1,
      clientId: 1,
      email: 'portal.test@clienteprueba.pe',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuuVWXYZ0123456789abcdefghijklmno',
      fullName: 'Usuario de prueba',
      isAdmin: 0,
      isActive: 1,
      lastLoginAt: null,
      createdBy: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ];
  let nextId = 2;

  const repo = {
    findByEmail: jest.fn((email: string) =>
      Promise.resolve(almacen.find((u) => u.email === normalize(email)) ?? null),
    ),
    findById: jest.fn((id: number) => Promise.resolve(almacen.find((u) => u.id === id) ?? null)),
    listByClient: jest.fn((clientId: number) =>
      Promise.resolve(almacen.filter((u) => u.clientId === clientId)),
    ),
    create: jest.fn((data: any) => {
      const row = {
        lastLoginAt: null,
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        ...data,
        id: nextId++,
        email: normalize(data.email),
      };
      almacen.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn((id: number, data: any) => {
      const row = almacen.find((u) => u.id === id);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data);
      if (data.email !== undefined) row.email = normalize(data.email);
      return Promise.resolve(row);
    }),
  };

  const clients = {
    findByIdOrFail: jest.fn((id: number) => {
      if (Number(id) !== 1) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Cliente no encontrado' });
      }
      return Promise.resolve(CLIENT);
    }),
  };

  const service = new ClientUsersService(repo as any, clients as any);
  return { service, repo, clients, almacen };
};

const dtoBase = {
  clientId: 1,
  email: 'nuevo@clienteprueba.pe',
  password: 'ClaveSegura1',
  fullName: 'Usuario Nuevo',
};

describe('ClientUsersService.create', () => {
  it('valida que el cliente exista antes de escribir nada', async () => {
    const { service, repo, clients } = makeService();
    await expect(
      service.create(9, { ...dtoBase, clientId: 99 } as any),
    ).rejects.toThrow(NotFoundException);
    expect(clients.findByIdOrFail).toHaveBeenCalledWith(99);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('un correo repetido devuelve CONFLICT y no llega a escribir', async () => {
    const { service, repo } = makeService();
    const error = await service
      .create(9, { ...dtoBase, email: 'portal.test@clienteprueba.pe' } as any)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('el correo repetido con otras mayusculas tambien es CONFLICT: el indice es case-insensitive', async () => {
    const { service, repo } = makeService();
    await expect(
      service.create(9, { ...dtoBase, email: 'PORTAL.TEST@ClientePrueba.PE' } as any),
    ).rejects.toThrow(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('la carrera del correo duplicado tambien es CONFLICT, con el mismo cuerpo que la comprobacion previa', async () => {
    const { service, repo } = makeService();
    // La comprobacion previa (findByEmail) no ve nada: simula que otra alta
    // concurrente con el mismo correo gano la carrera y el INSERT choca
    // contra el indice unico de la base.
    repo.create.mockRejectedValueOnce(makeQueryFailedError('ER_DUP_ENTRY', "Duplicate entry 'x' for key 'uq_client_users_email'"));

    const error = await service.create(9, dtoBase as any).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      code: 'CONFLICT',
      message: `Ya existe un usuario de cliente con el correo ${dtoBase.email}`,
    });
  });

  it('un QueryFailedError que no es de clave duplicada sigue subiendo tal cual, no se convierte en 409', async () => {
    const { service, repo } = makeService();
    const otroError = makeQueryFailedError('ER_NO_REFERENCED_ROW_2', 'Cannot add or update a child row');
    repo.create.mockRejectedValueOnce(otroError);

    const error = await service.create(9, dtoBase as any).catch((e) => e);
    expect(error).toBe(otroError);
    expect(error).not.toBeInstanceOf(ConflictException);
  });

  it('normaliza el correo a minusculas al guardar', async () => {
    const { service, almacen } = makeService();
    const created = await service.create(9, { ...dtoBase, email: 'Nuevo@ClientePrueba.PE' } as any);
    expect(created.email).toBe('nuevo@clienteprueba.pe');
    expect(almacen.find((u) => u.id === created.id)!.email).toBe('nuevo@clienteprueba.pe');
  });

  it('hashea la contraseña con bcrypt a coste 10, nunca en texto plano', async () => {
    const { service, almacen } = makeService();
    const created = await service.create(9, dtoBase as any);
    const row = almacen.find((u) => u.id === created.id)!;
    expect(row.passwordHash).not.toBe(dtoBase.password);
    expect(row.passwordHash.startsWith('$2b$10$')).toBe(true);
    await expect(bcrypt.compare(dtoBase.password, row.passwordHash)).resolves.toBe(true);
  });

  it('graba quien lo dio de alta como createdBy, tomado de la sesion y no del cuerpo', async () => {
    const { service, almacen } = makeService();
    const created = await service.create(42, dtoBase as any);
    expect(almacen.find((u) => u.id === created.id)!.createdBy).toBe(42);
  });

  it('la respuesta de alta no lleva passwordHash bajo ninguna clave', async () => {
    const { service } = makeService();
    const created = await service.create(9, dtoBase as any);
    expect(created).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(created).toLowerCase()).not.toContain('passwordhash');
    expect(Object.keys(created).sort()).toEqual(
      ['id', 'clientId', 'email', 'fullName', 'isAdmin', 'isActive', 'lastLoginAt', 'createdAt', 'updatedAt'].sort(),
    );
  });
});

describe('ClientUsersService.update', () => {
  it('update de un usuario inexistente da NOT_FOUND', async () => {
    const { service } = makeService();
    await expect(service.update(999, { fullName: 'x' } as any)).rejects.toThrow(NotFoundException);
  });

  it('jamas cambia el clientId aunque llegue en el cuerpo', async () => {
    const { service, almacen } = makeService();
    const updated = await service.update(1, { fullName: 'Nuevo Nombre', clientId: 2 } as any);
    expect(updated.clientId).toBe(1);
    expect(almacen.find((u) => u.id === 1)!.clientId).toBe(1);
  });

  it('permite cambiar la contraseña, re-hasheandola a coste 10', async () => {
    const { service, almacen } = makeService();
    await service.update(1, { password: 'OtraClaveNueva1' } as any);
    const row = almacen.find((u) => u.id === 1)!;
    expect(row.passwordHash.startsWith('$2b$10$')).toBe(true);
    await expect(bcrypt.compare('OtraClaveNueva1', row.passwordHash)).resolves.toBe(true);
  });

  it('sin password en el cuerpo no toca el hash existente', async () => {
    const { service, almacen } = makeService();
    const before = almacen.find((u) => u.id === 1)!.passwordHash;
    await service.update(1, { fullName: 'Solo nombre' } as any);
    expect(almacen.find((u) => u.id === 1)!.passwordHash).toBe(before);
  });

  it('permite cambiar fullName, isActive e isAdmin', async () => {
    const { service, almacen } = makeService();
    const updated = await service.update(1, { fullName: 'Cambiado', isActive: false, isAdmin: true } as any);
    expect(updated.fullName).toBe('Cambiado');
    expect(updated.isActive).toBe(false);
    expect(updated.isAdmin).toBe(true);
    expect(almacen.find((u) => u.id === 1)!.isActive).toBe(0);
    expect(almacen.find((u) => u.id === 1)!.isAdmin).toBe(1);
  });

  it('la respuesta de update tampoco lleva passwordHash', async () => {
    const { service } = makeService();
    const updated = await service.update(1, { fullName: 'Cambiado' } as any);
    expect(updated).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(updated).toLowerCase()).not.toContain('passwordhash');
  });
});

describe('ClientUsersService.listByClient', () => {
  it('no expone passwordHash de ningun usuario devuelto', async () => {
    const { service } = makeService();
    const rows = await service.listByClient(1);
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => expect(r).not.toHaveProperty('passwordHash'));
  });

  it('solo devuelve usuarios del cliente pedido', async () => {
    const { service, repo } = makeService();
    await service.listByClient(1);
    expect(repo.listByClient).toHaveBeenCalledWith(1);
  });
});

describe('el dto de actualizacion', () => {
  it('no admite clientId: con forbidNonWhitelisted (config real del ValidationPipe) lo rechaza', async () => {
    const instancia = plainToInstance(UpdateClientUserDto, { fullName: 'x', clientId: 99 });
    const errores = await validate(instancia, { whitelist: true, forbidNonWhitelisted: true });
    expect(errores.some((e) => e.property === 'clientId')).toBe(true);
  });

  it('acepta una edicion minima sin ningun campo', async () => {
    const instancia = plainToInstance(UpdateClientUserDto, {});
    const errores = await validate(instancia, { whitelist: true, forbidNonWhitelisted: true });
    expect(errores).toEqual([]);
  });
});
