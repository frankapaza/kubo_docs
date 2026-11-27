import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * Opciones de TypeORM compartidas por los dos módulos raíz (backend web y
 * monitor-worker). Extraídas de `AppModule` sin cambiar su comportamiento.
 */
export function typeOrmOptionsFactory(cfg: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'mysql',
    host: cfg.get<string>('DB_HOST'),
    port: parseInt(cfg.get<string>('DB_PORT', '3306'), 10),
    username: cfg.get<string>('DB_USER'),
    password: cfg.get<string>('DB_PASSWORD'),
    database: cfg.get<string>('DB_NAME'),
    autoLoadEntities: true,
    synchronize: false,
    charset: 'utf8mb4',
    // mysql2 convierte los Date de JS usando la zona local del proceso.
    // Con 'Z' lee y escribe los DATETIME en UTC, de modo que DATETIME y
    // TIMESTAMP round-trip de forma coherente y la aritmetica de SLA cuadra.
    timezone: 'Z',
    // Una columna DATE no tiene hora ni zona. Con timezone:'Z' el driver la
    // convertía a un Date en medianoche UTC y al serializarla volvía el día
    // anterior. Devolverlas como string las deja intactas, que es lo que las
    // entidades ya declaran.
    dateStrings: ['DATE'],
    // BIGINT se convierte a number si es seguro (< 2^53); strings si es más grande.
    // Esto evita comparaciones fallidas en el frontend (t.id === selectedId).
    supportBigNumbers: true,
    bigNumberStrings: false,
  };
}

/** Conexión de BullMQ (Redis) compartida por los dos módulos raíz. */
export function bullOptionsFactory(cfg: ConfigService) {
  return {
    connection: {
      host: cfg.get<string>('REDIS_HOST'),
      port: parseInt(cfg.get<string>('REDIS_PORT', '6379'), 10),
    },
  };
}
