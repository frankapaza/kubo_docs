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

/**
 * Las tablas que tienen que estar: client_users (013), las plantillas (015) y
 * las dos de la conversación (018).
 */
const TABLAS_ESPERADAS = [
  'client_users',
  'notification_templates',
  'ticket_messages',
  'ticket_attachments',
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
    const error = await build(
      ['client_users', 'ticket_messages', 'ticket_attachments'],
      [...COLUMNAS_013, COLUMNA_014, COLUMNA_016],
    )
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
    expect(message).not.toContain('018_conversacion_adjuntos.sql');
  });

  /**
   * La 018 se atribuye sola, igual que la 016. Importa que no se confunda con
   * la 015: las dos tocan `notification_templates` —una la crea, la otra le
   * siembra dos filas— y mandar al operador a la 015 no le crearía nunca el
   * hilo de mensajes.
   */
  it('atribuye a la 018 el hilo de mensajes y los adjuntos, sin culpar a la 015', async () => {
    const error = await build(
      ['client_users', 'notification_templates'],
      COLUMNAS_ESPERADAS,
    )
      .onApplicationBootstrap()
      .catch((e: Error) => e);
    const message = (error as Error).message;
    expect(message).toContain('018_conversacion_adjuntos.sql');
    expect(message).toContain('ticket_messages');
    expect(message).toContain('ticket_attachments');
    expect(message).not.toContain('013_portal_clientes.sql');
    expect(message).not.toContain('015_notificaciones.sql');
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
    const error = await build(
      ['client_users', 'ticket_messages', 'ticket_attachments'],
      [...COLUMNAS_013, COLUMNA_014, COLUMNA_016],
    )
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

  /**
   * El buzon del equipo es el unico requisito que la 015 NO puede satisfacer
   * por si sola. Su ayudante esta guardado tambien por tabla y se salta la
   * columna en silencio cuando `workspace_settings` no existe -- que es
   * exactamente el caso del stack de produccion, donde esa tabla no la creaba
   * nadie. Decirle al operador "aplica la 015, es idempotente" es mandarlo a
   * un arreglo que no funciona: ya la aplico, y volver a pasarla no crea la
   * columna. El mensaje tiene que nombrar antes los ficheros que crean la
   * tabla, y en el orden en que van.
   */
  describe('el buzon del equipo: la 015 sola no puede crearlo', () => {
    const sinBuzon = COLUMNAS_ESPERADAS.filter(
      (c) => !(c.tableName === 'workspace_settings' && c.columnName === 'team_inbox_email'),
    );

    const mensaje = async (): Promise<string> => {
      const error = await build(TABLAS_ESPERADAS, sinBuzon)
        .onApplicationBootstrap()
        .catch((e: Error) => e);
      return (error as Error).message;
    };

    it('nombra los dos ficheros que crean workspace_settings, no solo la 015', async () => {
      const message = await mensaje();
      expect(message).toContain('add_workspace_settings.sql');
      expect(message).toContain('add_workspace_smtp_and_session.sql');
      expect(message).toContain('015_notificaciones.sql');
    });

    it('los pone en el orden en que hay que aplicarlos', async () => {
      const message = await mensaje();
      // La 015 anade la columna AFTER smtp_from: al reves, el ALTER revienta.
      expect(message.indexOf('add_workspace_settings.sql')).toBeLessThan(
        message.indexOf('add_workspace_smtp_and_session.sql'),
      );
      expect(message.indexOf('add_workspace_smtp_and_session.sql')).toBeLessThan(
        message.indexOf('015_notificaciones.sql'),
      );
    });

    it('da la orden de aplicar cada uno, tambien la de los que no estan en migrations/', async () => {
      const message = await mensaje();
      expect(message).toMatch(/mysql .*< *backend\/sql\/add_workspace_settings\.sql/);
    });

    it('explica por que volver a pasar solo la 015 no crea la columna', async () => {
      const message = await mensaje();
      expect(message).toMatch(/silencio/i);
      expect(message).toMatch(/workspace_settings/);
    });

    /**
     * Los `add_workspace_*.sql` no llevan guardas de information_schema: son
     * ALTER pelados. Decir "son idempotentes" a secas de todo el lote manda al
     * operador a un ALTER que falla por columna duplicada.
     */
    it('no promete que los add_workspace_* sean idempotentes', async () => {
      const message = await mensaje();
      expect(message).toMatch(/no llevan guardas|no son idempotentes/i);
    });
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
