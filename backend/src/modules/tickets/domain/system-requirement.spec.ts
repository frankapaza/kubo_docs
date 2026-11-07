import {
  resolveTicketSystem,
  assertSystemBelongsToClient,
  soleActiveSystemId,
} from './system-requirement';

const ACTIVOS = [{ id: 5 }, { id: 6 }];

describe('resolveTicketSystem', () => {
  it('con sistemas asignados y sin elegir, no deja crear', () => {
    expect(() =>
      resolveTicketSystem({
        requirement: 'EXIGIDO',
        clientId: 7,
        systemId: undefined,
        activeSystems: ACTIVOS,
      }),
    ).toThrow('Elige el sistema afectado.');
  });

  it('sin ninguna asignacion activa, el campo es opcional y el alta sigue', () => {
    expect(
      resolveTicketSystem({
        requirement: 'EXIGIDO',
        clientId: 7,
        systemId: undefined,
        activeSystems: [],
      }),
    ).toBeNull();
  });

  it('sin cliente no hay de donde sacar sistemas, asi que no se exige nada', () => {
    expect(
      resolveTicketSystem({
        requirement: 'EXIGIDO',
        clientId: null,
        systemId: undefined,
        activeSystems: [],
      }),
    ).toBeNull();
  });

  it('la ingesta esta exenta: entra sin sistema aunque el cliente tenga varios', () => {
    expect(
      resolveTicketSystem({
        requirement: 'EXENTO_SIN_QUIEN_ELIJA',
        clientId: 7,
        systemId: undefined,
        activeSystems: ACTIVOS,
      }),
    ).toBeNull();
  });

  it('un sistema que no esta entre los asignados activos se rechaza', () => {
    expect(() =>
      resolveTicketSystem({
        requirement: 'EXIGIDO',
        clientId: 7,
        systemId: 99,
        activeSystems: ACTIVOS,
      }),
    ).toThrow('El sistema indicado no es de este cliente o está inactivo.');
  });

  it('la exencion de la ingesta NO exime de que el sistema elegido sea valido', () => {
    expect(() =>
      resolveTicketSystem({
        requirement: 'EXENTO_SIN_QUIEN_ELIJA',
        clientId: 7,
        systemId: 99,
        activeSystems: ACTIVOS,
      }),
    ).toThrow('El sistema indicado no es de este cliente o está inactivo.');
  });

  // TypeORM hidrata todo `bigint` como cadena: el id que llega de la base es
  // "5", y con `===` el dueno legitimo se comeria un 400.
  it('compara por valor: el id de la base llega como cadena', () => {
    expect(
      resolveTicketSystem({
        requirement: 'EXIGIDO',
        clientId: 7,
        systemId: 5,
        activeSystems: [{ id: '5' } as unknown as { id: number }],
      }),
    ).toBe(5);
  });
});

describe('assertSystemBelongsToClient', () => {
  it('no dice nada cuando no se toca el sistema', () => {
    expect(() =>
      assertSystemBelongsToClient({ systemId: undefined, activeSystems: [] }),
    ).not.toThrow();
  });

  it('rechaza un sistema inactivo o de otra empresa', () => {
    expect(() => assertSystemBelongsToClient({ systemId: 99, activeSystems: ACTIVOS })).toThrow(
      'El sistema indicado no es de este cliente o está inactivo.',
    );
  });
});

describe('soleActiveSystemId', () => {
  it('con un solo sistema asignado y activo, ese es', () => {
    expect(soleActiveSystemId([{ id: 5 }])).toBe(5);
  });

  it('con dos, no se adivina', () => {
    expect(soleActiveSystemId([{ id: 5 }, { id: 6 }])).toBeNull();
  });

  it('sin ninguno, no hay nada que elegir', () => {
    expect(soleActiveSystemId([])).toBeNull();
  });

  it('el id de la base llega como cadena y sale como numero', () => {
    expect(soleActiveSystemId([{ id: '5' } as unknown as { id: number }])).toBe(5);
  });
});
