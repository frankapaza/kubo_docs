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

/**
 * Lo que anade la 015 a tablas ya existentes: las tres columnas de la bandeja
 * de salida y el buzon del equipo en los ajustes.
 */
const COLUMNAS_015 = [
  { tableName: 'ticket_events', columnName: 'notified_at' },
  { tableName: 'ticket_events', columnName: 'notify_attempts' },
  { tableName: 'ticket_events', columnName: 'notify_last_error' },
  { tableName: 'workspace_settings', columnName: 'team_inbox_email' },
];

/**
 * Lo que anade la 016: el instante del siguiente intento. Sin ella el vigilante
 * medía la espera desde `created_at` y cualquier evento viejo gastaba sus tres
 * intentos en tres pasadas seguidas.
 */
const COLUMNA_016 = { tableName: 'ticket_events', columnName: 'notify_next_attempt_at' };

const COLUMNAS_ESPERADAS = [...COLUMNAS_013, COLUMNA_014, ...COLUMNAS_015, COLUMNA_016];

/** Las tablas que tienen que estar: client_users (013) y las plantillas (015). */
const TABLAS_ESPERADAS = ['client_users', 'notification_templates'];

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

  it('arranca si las tablas y todas las columnas esperadas estan', async () => {
    await expect(
      build(TABLAS_ESPERADAS, COLUMNAS_ESPERADAS).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  it.each(TABLAS_ESPERADAS)('aborta si falta la tabla %s', async (ausente) => {
    const presentes = TABLAS_ESPERADAS.filter((t) => t !== ausente);
    await expect(build(presentes, COLUMNAS_ESPERADAS).onApplicationBootstrap()).rejects.toThrow(
      new RegExp(ausente),
    );
  });

  it.each(COLUMNAS_ESPERADAS.map((c) => [`${c.tableName}.${c.columnName}`, c]))(
    'aborta si falta la columna %s',
    async (etiqueta, ausente) => {
      const presentes = COLUMNAS_ESPERADAS.filter((c) => c !== ausente);
      await expect(
        build(TABLAS_ESPERADAS, presentes).onApplicationBootstrap(),
      ).rejects.toThrow(new RegExp(etiqueta as string));
    },
  );

  it('atribuye cada ausencia a su migracion: la 014 es la de audit_log', async () => {
    const error = await build(TABLAS_ESPERADAS, [...COLUMNAS_013, ...COLUMNAS_015, COLUMNA_016])
      .onApplicationBootstrap()
      .catch((e: Error) => e);
    const message = (error as Error).message;
    expect(message).toContain('014_audit_client_user.sql');
    expect(message).toContain('audit_log.client_user_id');
    // Solo se nombra lo que de verdad falta: las otras tres estan aplicadas.
    expect(message).not.toContain('013_portal_clientes.sql');
    expect(message).not.toContain('015_notificaciones.sql');
    expect(message).not.toContain('016_notify_next_attempt.sql');
  });

  it('atribuye a la 015 la tabla de plantillas, la bandeja y el buzon del equipo', async () => {
    const error = await build(['client_users'], [...COLUMNAS_013, COLUMNA_014, COLUMNA_016])
      .onApplicationBootstrap()
      .catch((e: Error) => e);
    const message = (error as Error).message;
    expect(message).toContain('015_notificaciones.sql');
    expect(message).toContain('notification_templates');
    for (const { tableName, columnName } of COLUMNAS_015) {
      expect(message).toContain(`${tableName}.${columnName}`);
    }
    // Las otras estan aplicadas: no se nombran.
    expect(message).not.toContain('013_portal_clientes.sql');
    expect(message).not.toContain('014_audit_client_user.sql');
    expect(message).not.toContain('016_notify_next_attempt.sql');
  });

  /**
   * La 016 se atribuye sola. Importa distinguirla de la 015: son dos ficheros
   * distintos y aplicar solo la 015 deja al vigilante sin la columna con la que
   * mide la espera entre reintentos.
   */
  it('atribuye a la 016 el instante del siguiente intento, sin culpar a la 015', async () => {
    const error = await build(TABLAS_ESPERADAS, [...COLUMNAS_013, COLUMNA_014, ...COLUMNAS_015])
      .onApplicationBootstrap()
      .catch((e: Error) => e);
    const message = (error as Error).message;
    expect(message).toContain('016_notify_next_attempt.sql');
    expect(message).toContain('ticket_events.notify_next_attempt_at');
    expect(message).not.toContain('015_notificaciones.sql');
  });

  it('avisa de que las columnas de la 015 no se anaden a mano: el sellado va dentro', async () => {
    const error = await build(['client_users'], [...COLUMNAS_013, COLUMNA_014, COLUMNA_016])
      .onApplicationBootstrap()
      .catch((e: Error) => e);
    // Crear notified_at a mano deja el historico sin sellar, y el vigilante
    // manda un correo por cada evento de meses atras. El mensaje tiene que
    // desaconsejarlo explicitamente, no solo pedir la migracion.
    expect((error as Error).message).toMatch(/a mano/i);
    expect((error as Error).message).toMatch(/sellado/i);
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

  it('nombra a la vez las tablas y todas las columnas ausentes, no solo la primera', async () => {
    const error = await build([], [])
      .onApplicationBootstrap()
      .catch((e: Error) => e);
    const message = (error as Error).message;
    for (const tabla of TABLAS_ESPERADAS) {
      expect(message).toContain(tabla);
    }
    for (const { tableName, columnName } of COLUMNAS_ESPERADAS) {
      expect(message).toContain(`${tableName}.${columnName}`);
    }
  });
});
