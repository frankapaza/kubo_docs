import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Algo que el código da por hecho y la base no tiene todavía. */
interface MissingItem {
  kind: 'tabla' | 'columna';
  /** `client_users` o `tickets.created_by_client_user_id`. */
  name: string;
  migration: string;
}

/** Cómo aplicar a mano una migración sobre una base que ya tiene datos. */
const comoAplicarla = (migration: string): string =>
  'docker compose exec -T mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" kubo_devdocs ' +
  `< backend/sql/migrations/${migration}`;

/**
 * Comprueba al arranque que la migración 013 está aplicada, y aborta si no.
 *
 * El portal de clientes no solo añade tablas nuevas: **modifica entidades ya
 * existentes**. `ticket.entity.ts` declara `created_by_client_user_id` y
 * `ticket-event.entity.ts` declara `actor_client_user_id`, así que TypeORM las
 * emite en todo SELECT e INSERT sobre `tickets` y `ticket_events`. Contra una
 * base sin la 013, eso es `ER_BAD_FIELD_ERROR` en el listado de tickets, el
 * detalle, cada transición, la asignación y el escaneo de SLA: la rama tumba
 * lo que ya funcionaba, y lo hace con un aluvión de 500 que no dice por qué.
 *
 * Y es un escenario probable, no teórico: las migraciones solo se ejecutan por
 * `docker-entrypoint-initdb.d`, que MySQL corre **únicamente sobre un
 * directorio de datos vacío**. El volumen `mysql_data` sobrevive a
 * `docker compose up -d --build`, así que cualquier despliegue sobre una base
 * con datos previos se queda sin la 013 y no hay runner que lo detecte.
 *
 * Sigue la forma de `DbTimezoneInitializer` y `JwtSecretsValidator`: hacer
 * explícita al boot una precondición que de otro modo solo se nota cuando ya
 * es tarde, y abortar con un mensaje que diga qué falta y cómo arreglarlo en
 * vez de aceptar tráfico en ese estado.
 *
 * Consulta `information_schema` en vez de dejar que falle un SELECT: así se
 * distingue "falta la migración" de "la base está caída", y el diagnóstico
 * sale entero de una sola pasada (tabla y las cuatro columnas), no de la
 * primera consulta que reviente.
 */
@Injectable()
export class PortalSchemaValidator implements OnApplicationBootstrap {
  private readonly logger = new Logger('PortalSchemaValidator');

  private static readonly MIGRATION_013 = '013_portal_clientes.sql';
  private static readonly MIGRATION_014 = '014_audit_client_user.sql';

  /** Tablas nuevas de la 013. */
  private static readonly REQUIRED_TABLES: ReadonlyArray<{ table: string; migration: string }> = [
    { table: 'client_users', migration: PortalSchemaValidator.MIGRATION_013 },
  ];

  /**
   * Columnas hermanas del actor que las migraciones del portal añaden a tablas
   * ya existentes. Son las peligrosas: sin ellas, las entidades mienten sobre
   * el esquema real y lo que deja de funcionar es código que ya existía.
   */
  private static readonly REQUIRED_COLUMNS: ReadonlyArray<{
    table: string;
    column: string;
    migration: string;
  }> = [
    { table: 'tickets', column: 'created_by_client_user_id', migration: PortalSchemaValidator.MIGRATION_013 },
    { table: 'ticket_events', column: 'actor_client_user_id', migration: PortalSchemaValidator.MIGRATION_013 },
    { table: 'work_items', column: 'created_by_client_user_id', migration: PortalSchemaValidator.MIGRATION_013 },
    { table: 'work_item_events', column: 'actor_client_user_id', migration: PortalSchemaValidator.MIGRATION_013 },
    // 014: sin ella, la entidad AuditLog pide una columna que no existe y
    // TODA la auditoría se pierde en silencio (el interceptor degrada el
    // fallo del INSERT a un warn por petición).
    { table: 'audit_log', column: 'client_user_id', migration: PortalSchemaValidator.MIGRATION_014 },
  ];

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const missing = [...(await this.findMissingTables()), ...(await this.findMissingColumns())];

    if (missing.length > 0) {
      throw new Error(PortalSchemaValidator.buildMessage(missing));
    }

    this.logger.log(
      'Esquema del portal de clientes verificado: las migraciones ' +
        `${PortalSchemaValidator.MIGRATION_013} y ${PortalSchemaValidator.MIGRATION_014} están ` +
        'aplicadas (client_users y las columnas del actor existen).',
    );
  }

  private async findMissingTables(): Promise<MissingItem[]> {
    const rows: Array<{ tableName: string }> = await this.dataSource.query(
      'SELECT TABLE_NAME AS tableName FROM information_schema.TABLES ' +
        'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
      [PortalSchemaValidator.REQUIRED_TABLES.map((t) => t.table)],
    );
    const present = new Set(rows.map((r) => r.tableName));
    return PortalSchemaValidator.REQUIRED_TABLES.filter((t) => !present.has(t.table)).map((t) => ({
      kind: 'tabla',
      name: t.table,
      migration: t.migration,
    }));
  }

  private async findMissingColumns(): Promise<MissingItem[]> {
    const tables = [...new Set(PortalSchemaValidator.REQUIRED_COLUMNS.map((c) => c.table))];
    const rows: Array<{ tableName: string; columnName: string }> = await this.dataSource.query(
      'SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS ' +
        'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
      [tables],
    );
    const present = new Set(rows.map((r) => `${r.tableName}.${r.columnName}`));
    return PortalSchemaValidator.REQUIRED_COLUMNS.filter(
      (c) => !present.has(`${c.table}.${c.column}`),
    ).map((c) => ({ kind: 'columna', name: `${c.table}.${c.column}`, migration: c.migration }));
  }

  /**
   * Un solo mensaje con todo lo que falta, agrupado por migración: el operador
   * ve de una vez qué ficheros tiene que pasar y en qué orden, sin arrancar
   * cinco veces para descubrirlos de uno en uno.
   */
  private static buildMessage(missing: MissingItem[]): string {
    const porMigracion = [...new Set(missing.map((m) => m.migration))].sort();

    const detalle = porMigracion
      .map((migration) => {
        const suyos = missing.filter((m) => m.migration === migration);
        const tablas = suyos.filter((m) => m.kind === 'tabla').map((m) => m.name);
        const columnas = suyos.filter((m) => m.kind === 'columna').map((m) => m.name);
        const que = [
          tablas.length > 0 ? `tablas: ${tablas.join(', ')}` : null,
          columnas.length > 0 ? `columnas: ${columnas.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join('; ');
        return `${migration} (${que})\n    ${comoAplicarla(migration)}`;
      })
      .join('\n  ');

    return (
      'Faltan migraciones por aplicar en esta base de datos:\n  ' +
      `${detalle}\n` +
      'Las entidades ya declaran esas columnas, así que TypeORM las emite en todo SELECT e ' +
      'INSERT: sin la 013, el listado de tickets, el detalle, las transiciones, la asignación y ' +
      'el escaneo de SLA responden 500 (ER_BAD_FIELD_ERROR); sin la 014 se pierde toda la ' +
      'auditoría. Las migraciones solo se ejecutan por docker-entrypoint-initdb.d, y MySQL solo ' +
      'corre ese directorio sobre un datadir vacío: una base que ya tenía datos NO las recibe al ' +
      'reconstruir los contenedores. Aplícalas a mano (son idempotentes) y vuelve a arrancar.'
    );
  }
}
