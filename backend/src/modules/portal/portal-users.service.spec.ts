import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { PortalUsersService } from './portal-users.service';

/** Fila tal como la devuelve TypeORM: los `bigint` salen como CADENA. */
function fila(over: Record<string, unknown> = {}) {
  return {
    id: '5',
    clientId: '7',
    email: 'ana@kuboti.com',
    passwordHash: '$2b$10$loquesea',
    fullName: 'Ana Pérez',
    isAdmin: 0,
    isActive: 1,
    lastLoginAt: new Date('2026-08-20T10:00:00.000Z'),
    createdBy: null,
    createdByClientUserId: '3',
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    ...over,
  } as any;
}

function makeService(filas: any[] = [fila()]) {
  const repo = {
    listByClient: jest.fn(async () => filas),
    findById: jest.fn(async (id: number) => filas.find((f) => String(f.id) === String(id)) ?? null),
    deactivate: jest.fn(async () => undefined),
  };
  return { service: new PortalUsersService(repo as any), repo };
}

describe('PortalUsersService.list', () => {
  it('devuelve solo los campos de la lista blanca, y jamás el hash', async () => {
    const { service } = makeService();
    const [vista] = await service.list(7);

    expect(Object.keys(vista).sort()).toEqual(
      ['createdAt', 'email', 'fullName', 'id', 'isActive', 'isAdmin', 'lastLoginAt'].sort(),
    );
    expect(JSON.stringify(vista)).not.toContain('$2b$');
  });

  it('convierte los bigint que TypeORM devuelve como cadena a número', async () => {
    const { service } = makeService();
    const [vista] = await service.list(7);
    expect(vista.id).toBe(5);
  });

  it('no publica el clientId: la empresa es la de la sesión, no un dato que enseñar', async () => {
    const { service } = makeService();
    const [vista] = await service.list(7);
    expect(vista).not.toHaveProperty('clientId');
  });

  it('acota siempre por la empresa que le llega', async () => {
    const { service, repo } = makeService();
    await service.list(7);
    expect(repo.listByClient).toHaveBeenCalledWith(7);
  });

  it.each([[0], [-1], [Number.NaN]])(
    'una sesión con clientId inservible (%s) se rechaza sin consultar',
    async (malo) => {
      const { service, repo } = makeService();
      await expect(service.list(malo as number)).rejects.toThrow(UnauthorizedException);
      expect(repo.listByClient).not.toHaveBeenCalled();
    },
  );
});

describe('PortalUsersService.deactivate', () => {
  it('desactiva a alguien de su empresa', async () => {
    const { service, repo } = makeService([fila({ id: '5', clientId: '7' })]);
    const vista = await service.deactivate(7, 3, 5);
    expect(repo.deactivate).toHaveBeenCalledWith(5);
    expect(vista.isActive).toBe(false);
  });

  /**
   * 404 y NO 403: un 403 confirmaría que ese identificador existe de verdad,
   * que es justo lo que un atacante quiere saber. La respuesta de "es de otra
   * empresa" tiene que ser indistinguible de la de "no existe".
   */
  it('un usuario de otra empresa responde 404, no 403, y no se toca', async () => {
    const { service, repo } = makeService([fila({ id: '5', clientId: '99' })]);
    await expect(service.deactivate(7, 3, 5)).rejects.toThrow(NotFoundException);
    expect(repo.deactivate).not.toHaveBeenCalled();
  });

  it('un usuario que no existe responde exactamente lo mismo que uno ajeno', async () => {
    const ajeno = makeService([fila({ id: '5', clientId: '99' })]);
    const inexistente = makeService([]);

    const cuerpoAjeno = await ajeno.service.deactivate(7, 3, 5).catch((e) => e.getResponse());
    const cuerpoInexistente = await inexistente.service
      .deactivate(7, 3, 5)
      .catch((e) => e.getResponse());

    expect(cuerpoAjeno).toEqual(cuerpoInexistente);
  });

  /**
   * Decisión 5 de la spec. Si un administrador pudiera desactivarse a sí
   * mismo, una empresa podría quedarse sin ningún administrador y sin forma de
   * recuperarlo salvo llamándonos. Se rechaza en el servidor, no solo en la
   * pantalla.
   */
  it('un administrador no puede desactivarse a sí mismo', async () => {
    const { service, repo } = makeService([fila({ id: 3, clientId: 7, isAdmin: 1 })]);
    await expect(service.deactivate(7, 3, 3)).rejects.toThrow(/no puedes quitarte a ti/i);
    expect(repo.deactivate).not.toHaveBeenCalled();
  });

  /**
   * Y ahora con los tipos que llegan DE VERDAD: el id del actor viene del token
   * (número) y el de la fila viene de la base (cadena, porque TypeORM hidrata
   * todo `bigint` así). Con `===` esta comparación sería siempre falsa y el
   * administrador SÍ podría quitarse el acceso — la empresa se quedaría sin
   * nadie que pudiera invitar. Por eso `sameId`.
   */
  it('se reconoce a sí mismo aunque el id de la fila llegue como cadena', async () => {
    const { service, repo } = makeService([fila({ id: '3', clientId: '7', isAdmin: 1 })]);
    await expect(service.deactivate(7, 3, 3)).rejects.toThrow(/no puedes quitarte a ti/i);
    expect(repo.deactivate).not.toHaveBeenCalled();
  });

  /**
   * Decisión 9 de la spec: si el administrador de cliente no puede nombrar
   * administradores (decisión 2), tampoco puede quitarles el acceso — solo a
   * los usuarios normales que sí puede crear. El objetivo aquí NO es el
   * propio actor (3 ≠ 5): esta guarda es distinta de "no te desactives a ti
   * mismo", no una reformulación suya. LA PRUEBA QUE DEMUESTRA QUE SON DOS
   * GUARDAS Y NO UNA: si alguien colapsara las dos comprobaciones en un único
   * `if` del tipo "es administrador Y es el mismo id que el actor", esta
   * prueba seguiría en verde por accidente salvo que de verdad se ejerza con
   * un `targetId` distinto del actor — que es justo lo que hace.
   */
  it('un administrador no puede desactivar a OTRO administrador', async () => {
    const { service, repo } = makeService([fila({ id: '5', clientId: '7', isAdmin: 1 })]);
    await expect(service.deactivate(7, 3, 5)).rejects.toThrow(BadRequestException);
    await expect(service.deactivate(7, 3, 5)).rejects.toThrow(/otro administrador/i);
    expect(repo.deactivate).not.toHaveBeenCalled();
  });

  /**
   * El complemento negativo de la prueba anterior: mismo actor, mismo
   * objetivo ajeno, pero SIN ser administrador. Tiene que pasar. Sin esta
   * prueba, alguien podría "arreglar" un fallo de tipos en `usuario.isAdmin`
   * (por ejemplo, comparar contra la cadena `'1'` en vez de contra un valor
   * truthy) haciendo que la guarda rechace a TODO el mundo, y la suite
   * seguiría en verde si solo se comprobara el caso que sí debe fallar.
   */
  it('sí puede desactivar a un usuario normal de su empresa', async () => {
    const { service, repo } = makeService([fila({ id: '5', clientId: '7', isAdmin: 0 })]);
    const vista = await service.deactivate(7, 3, 5);
    expect(repo.deactivate).toHaveBeenCalledWith(5);
    expect(vista.isActive).toBe(false);
  });
});
