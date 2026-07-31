import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * El reloj de SLA (`SlaService.consumed`, ver global-constraints.md, sección
 * "Zona horaria") asume que `tickets.created_at`, `sla_response_due_at`, etc.
 * viajan en UTC de punta a punta. `app.module.ts` fija `timezone: 'Z'` en
 * mysql2 para que el DRIVER lea/escriba en UTC, pero eso solo controla la
 * conversión en el cliente: las columnas `TIMESTAMP` las convierte el
 * SERVIDOR según la zona de sesión, y nada la fija por defecto. Si el MySQL
 * de producción no arranca en UTC, `tickets.created_at` vuelve a leerse con
 * el desfase de 5 horas que arregló la Tarea 8 — en silencio, porque la app
 * arranca igual y solo se nota cuando el SLA de todos los tickets aparece al
 * 100 % consumido.
 *
 * Esta clase hace explícita la precondición en vez de dejarla en un
 * comentario:
 *
 *  1) Fuerza `SET time_zone = '+00:00'` en cada conexión física que abra el
 *     pool de mysql2, enganchándose al evento `'connection'` que emite
 *     `mysql2/lib/base/pool.js` al crear una conexión nueva — es el único
 *     mecanismo que expone mysql2 (y por lo tanto TypeORM 0.3, que lo usa
 *     tal cual) para ejecutar SQL de inicialización por conexión; no hay
 *     opción de "init SQL" en la config del pool.
 *  2) TypeORM abre y libera una conexión de prueba al conectar (para fallar
 *     rápido si las credenciales son inválidas) ANTES de que este hook
 *     pueda suscribirse al evento — esa conexión ya está en el pool y no
 *     dispara un nuevo evento `'connection'` al reutilizarse. Por eso se
 *     fuerza también con una query explícita apenas arranca la app, antes
 *     de aceptar tráfico.
 *  3) Verifica el resultado y, si la sesión no quedó en UTC, tira el error
 *     en vez de dejar que seleccione en silencio 100 % de SLA consumido
 *     para todos los tickets.
 */
@Injectable()
export class DbTimezoneInitializer implements OnApplicationBootstrap {
  private readonly logger = new Logger('DbTimezoneInitializer');

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    this.hookPoolConnections();

    // Cubre la conexión que TypeORM ya dejó en el pool al probar
    // credenciales (ver punto 2 del docblock de la clase).
    await this.dataSource.query("SET time_zone = '+00:00'");

    const rows: Array<{ tz: string }> = await this.dataSource.query(
      'SELECT @@session.time_zone AS tz',
    );
    const tz = rows?.[0]?.tz;
    if (tz !== '+00:00' && tz !== 'UTC') {
      throw new Error(
        `La sesión de MySQL no quedó en UTC (time_zone = "${tz}"). El reloj de SLA ` +
          'asume que las columnas TIMESTAMP viajan en UTC; sin la sesión en UTC, ' +
          'tickets.created_at y las fechas límite de SLA vuelven a leerse con el ' +
          'desfase horario que arregló la Tarea 8. Revisa la configuración de zona ' +
          'horaria del servidor MySQL.',
      );
    }

    this.logger.log(`Zona horaria de sesión MySQL verificada en UTC (time_zone = "${tz}").`);
  }

  /**
   * `driver.pool` no es parte de la API pública de TypeORM: es la instancia
   * mysql2 (`Pool`) creada internamente por `MysqlDriver.createPool()`. Se
   * accede así porque TypeORM 0.3 no ofrece un hook propio de "conexión
   * establecida"; si en algún momento se actualiza mysql2/TypeORM y esto deja
   * de existir, el `if` de abajo lo detecta y loguea en vez de romper el
   * arranque — la verificación del punto 3 sigue siendo la red de seguridad.
   */
  private hookPoolConnections(): void {
    const pool = (this.dataSource.driver as unknown as { pool?: PoolLike }).pool;

    if (!pool || typeof pool.on !== 'function') {
      this.logger.warn(
        'No se encontró el pool mysql2 en driver.pool: no se pudo enganchar ' +
          "SET time_zone = '+00:00' por conexión. La verificación de arranque " +
          'sigue activa como red de seguridad.',
      );
      return;
    }

    pool.on('connection', (connection) => {
      connection.query("SET time_zone = '+00:00'", (err?: Error) => {
        if (err) {
          this.logger.error(`No se pudo fijar time_zone en una conexión nueva del pool: ${err.message}`);
        }
      });
    });
  }
}

interface PoolLike {
  on(event: 'connection', listener: (connection: PoolConnectionLike) => void): void;
}

interface PoolConnectionLike {
  query(sql: string, cb?: (err?: Error) => void): void;
}
