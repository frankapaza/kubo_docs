import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PortalSchemaValidator } from './portal-schema.validator';

/** Las cuatro columnas hermanas que añade la 013, tal y como las devolvería MySQL. */
const COLUMNAS_013 = [
  { tableName: 'tickets', columnName: 'created_by_client_user_id' },
  { tableName: 'ticket_events', columnName: 'actor_client_user_id' },
  { tableName: 'work_items', columnName: 'created_by_client_user_id' },
  { tableName: 'work_item_events', columnName: 'actor_client_user_id' },
];

/**
 * DataSource de mentira: responde a la consulta de tablas y a la de columnas
 * segun el catalogo que se le pase, igual que haria information_schema.
 */
const dataSourceWith = (
  tables: string[],
  columns: Array<{ tableName: string; columnName: string }>,
): DataSource =>
  ({
    query: jest.fn((sql: string) => {
      if (/information_schema\.TABLES/i.test(sql)) {
        return Promise.resolve(tables.map((t) => ({ tableName: t })));
      }
      if (/information_schema\.COLUMNS/i.test(sql)) {
        return Promise.resolve(columns);
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    }),
  }) as unknown as DataSource;

const build = (tables: string[], columns: Array<{ tableName: string; columnName: string }>) =>
  new PortalSchemaValidator(dataSourceWith(tables, columns));

describe('PortalSchemaValidator', () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('arranca si la tabla y las cuatro columnas de la 013 estan', async () => {
    await expect(
      build(['client_users'], COLUMNAS_013).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  it('aborta si falta la tabla client_users', async () => {
    await expect(build([], COLUMNAS_013).onApplicationBootstrap()).rejects.toThrow(
      /client_users/,
    );
  });

  it.each(COLUMNAS_013.map((c) => [`${c.tableName}.${c.columnName}`, c]))(
    'aborta si falta la columna %s',
    async (etiqueta, ausente) => {
      const presentes = COLUMNAS_013.filter((c) => c !== ausente);
      await expect(
        build(['client_users'], presentes).onApplicationBootstrap(),
      ).rejects.toThrow(new RegExp(etiqueta as string));
    },
  );

  it('el mensaje nombra la migracion que falta y como aplicarla', async () => {
    const error = await build([], [])
      .onApplicationBootstrap()
      .catch((e: Error) => e);
    expect((error as Error).message).toContain('013_portal_clientes.sql');
    // Sin la pista del despliegue el operador no sabria por que le falta:
    // docker-entrypoint-initdb.d solo corre sobre un datadir vacio.
    expect((error as Error).message).toMatch(/docker-entrypoint-initdb\.d/);
    expect((error as Error).message).toMatch(/mysql .*< *backend\/sql\/migrations/);
  });

  it('nombra a la vez la tabla y todas las columnas ausentes, no solo la primera', async () => {
    const error = await build([], [])
      .onApplicationBootstrap()
      .catch((e: Error) => e);
    const message = (error as Error).message;
    expect(message).toContain('client_users');
    for (const { tableName, columnName } of COLUMNAS_013) {
      expect(message).toContain(`${tableName}.${columnName}`);
    }
  });
});
