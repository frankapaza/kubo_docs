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

/** La columna que añade la 014: la autoría de cliente en la auditoría. */
const COLUMNA_014 = { tableName: 'audit_log', columnName: 'client_user_id' };

const COLUMNAS_ESPERADAS = [...COLUMNAS_013, COLUMNA_014];

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

  it('arranca si la tabla y todas las columnas esperadas estan', async () => {
    await expect(
      build(['client_users'], COLUMNAS_ESPERADAS).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  it('aborta si falta la tabla client_users', async () => {
    await expect(build([], COLUMNAS_ESPERADAS).onApplicationBootstrap()).rejects.toThrow(
      /client_users/,
    );
  });

  it.each(COLUMNAS_ESPERADAS.map((c) => [`${c.tableName}.${c.columnName}`, c]))(
    'aborta si falta la columna %s',
    async (etiqueta, ausente) => {
      const presentes = COLUMNAS_ESPERADAS.filter((c) => c !== ausente);
      await expect(
        build(['client_users'], presentes).onApplicationBootstrap(),
      ).rejects.toThrow(new RegExp(etiqueta as string));
    },
  );

  it('atribuye cada ausencia a su migracion: la 014 es la de audit_log', async () => {
    const error = await build(['client_users'], COLUMNAS_013)
      .onApplicationBootstrap()
      .catch((e: Error) => e);
    const message = (error as Error).message;
    expect(message).toContain('014_audit_client_user.sql');
    expect(message).toContain('audit_log.client_user_id');
    // Solo se nombra lo que de verdad falta: la 013 esta aplicada.
    expect(message).not.toContain('013_portal_clientes.sql');
  });

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
    for (const { tableName, columnName } of COLUMNAS_ESPERADAS) {
      expect(message).toContain(`${tableName}.${columnName}`);
    }
  });
});
