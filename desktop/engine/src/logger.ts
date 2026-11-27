import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { LOGS_DIR } from './config';
import type { EngineLogger } from './engine';

/**
 * Registro de diagnóstico en `{home}\logs\engine-AAAA-MM-DD.log`: rota a diario y a
 * los 10 MB, conserva 14 días. También a la consola (WinSW la recoge en sus registros).
 */
export function createLogger(home: string): EngineLogger & { close(): void } {
  const dir = join(home, LOGS_DIR);
  mkdirSync(dir, { recursive: true });
  const format = winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf((i) => `${String(i.timestamp)} ${i.level.toUpperCase()} ${String(i.message)}`),
  );
  const logger = winston.createLogger({
    level: 'info',
    format,
    transports: [
      new DailyRotateFile({ dirname: dir, filename: 'engine-%DATE%.log', datePattern: 'YYYY-MM-DD', maxSize: '10m', maxFiles: '14d' }),
      new winston.transports.Console(),
    ],
  });
  return {
    info: (m) => logger.info(m),
    warn: (m) => logger.warn(m),
    error: (m) => logger.error(m),
    close: () => logger.close(),
  };
}
