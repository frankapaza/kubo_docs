import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Cómo aplicar a mano una migración sobre una base que ya tiene datos. */
const COMO_APLICARLA =
  'docker compose exec -T mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" kubo_devdocs ' +
  '< backend/sql/migrations/013_portal_clientes.sql';

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

  /** La migración que aporta todo lo que se comprueba aquí. */
  private static readonly MIGRATION = '013_portal_clientes.sql';

  /** Tablas nuevas de la 013. */
  private static readonly REQUIRED_TABLES = ['client_users'] as const;

  /**
   * Columnas hermanas del actor que la 013 añade a tablas ya existentes. Son
   * las peligrosas: sin ellas, las entidades mienten sobre el esquema real y
   * el módulo de tickets interno deja de funcionar.
   */
  private static readonly REQUIRED_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
    { table: 'tickets', column: 'created_by_client_user_id' },
    { table: 'ticket_events', column: 'actor_client_user_id' },
    { table: 'work_items', column: 'created_by_client_user_id' },
    { table: 'work_item_events', column: 'actor_client_user_id' },
  ];

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const missingTables = await this.findMissingTables();
    const missingColumns = await this.findMissingColumns();

    if (missingTables.length > 0 || missingColumns.length > 0) {
      throw new Error(this.buildMessage(missingTables, missingColumns));
    }

    this.logger.log(
      `Esquema del portal de clientes verificado: la migración ${PortalSchemaValidator.MIGRATION} ` +
        'está aplicada (client_users y las cuatro columnas del actor existen).',
    );
  }

  private async findMissingTables(): Promise<string[]> {
    const rows: Array<{ tableName: string }> = await this.dataSource.query(
      'SELECT TABLE_NAME AS tableName FROM information_schema.TABLES ' +
        'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
      [[...PortalSchemaValidator.REQUIRED_TABLES]],
    );
    const present = new Set(rows.map((r) => r.tableName));
    return PortalSchemaValidator.REQUIRED_TABLES.filter((t) => !present.has(t));
  }

  private async findMissingColumns(): Promise<string[]> {
    const tables = [...new Set(PortalSchemaValidator.REQUIRED_COLUMNS.map((c) => c.table))];
    const rows: Array<{ tableName: string; columnName: string }> = await this.dataSource.query(
      'SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS ' +
        'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
      [tables],
    );
    const present = new Set(rows.map((r) => `${r.tableName}.${r.columnName}`));
    return PortalSchemaValidator.REQUIRED_COLUMNS.map((c) => `${c.table}.${c.column}`).filter(
      (qualified) => !present.has(qualified),
    );
  }

  private buildMessage(missingTables: string[], missingColumns: string[]): string {
    const faltantes = [
      missingTables.length > 0 ? `tablas: ${missingTables.join(', ')}` : null,
      missingColumns.length > 0 ? `columnas: ${missingColumns.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('; ');

    return (
      `Falta aplicar la migración ${PortalSchemaValidator.MIGRATION} en esta base de datos ` +
      `(${faltantes}). Las entidades Ticket y TicketEvent ya declaran esas columnas, así que ` +
      'TypeORM las emite en todo SELECT e INSERT: sin la migración, el listado de tickets, el ' +
      'detalle, las transiciones, la asignación y el escaneo de SLA responden 500 ' +
      '(ER_BAD_FIELD_ERROR). Las migraciones solo se ejecutan por docker-entrypoint-initdb.d, y ' +
      'MySQL solo corre ese directorio sobre un datadir vacío: una base que ya tenía datos NO la ' +
      `recibe al reconstruir los contenedores. Aplícala a mano y vuelve a arrancar: ${COMO_APLICARLA}`
    );
  }
}
