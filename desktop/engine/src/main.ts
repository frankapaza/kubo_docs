import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCheck, systemClock } from '@kubo/monitoring-core';
import { CentralClient } from './central-client';
import { DB_FILE, loadEngineConfig, loadLocalSecret, loadProbeToken, monitorHome } from './config';
import { Engine } from './engine';
import { startLocalApi } from './local-api';
import { createLogger } from './logger';
import { Outbox } from './outbox';

function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return 'dev';
  }
}

function main(): void {
  const home = monitorHome();
  const log = createLogger(home);
  const version = `engine-${packageVersion()}`;

  let config;
  let token: string;
  let secret: string;
  try {
    config = loadEngineConfig(home);
    token = loadProbeToken(home);
    secret = loadLocalSecret(home);
  } catch (err) {
    log.error(`No se pudo cargar la configuración de ${home}: ${err instanceof Error ? err.message : String(err)}`);
    // Salida con error: el SCM reintenta según la política de reinicio.
    setTimeout(() => process.exit(1), 500);
    return;
  }

  const outbox = new Outbox(join(home, DB_FILE));
  const central = new CentralClient(config.centralUrl, token);
  const engine = new Engine({ config, outbox, central, clock: systemClock, check: runCheck, version, logger: log });
  engine.start();
  const server = startLocalApi(engine, { port: config.localPort, secret });
  server.on('listening', () => log.info(`Motor ${version} en marcha; API local en 127.0.0.1:${config.localPort}; central ${config.centralUrl}.`));
  server.on('error', (err) => {
    log.error(`API local: ${err.message}`);
    shutdown(1);
  });

  let stopping = false;
  const shutdown = (code: number) => {
    if (stopping) return;
    stopping = true;
    log.info('Deteniendo el motor…');
    engine.stop();
    server.close();
    outbox.close();
    log.close();
    setTimeout(() => process.exit(code), 500);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGBREAK', () => shutdown(0));
  process.on('uncaughtException', (err) => {
    log.error(`Excepción no controlada: ${err.stack ?? err.message}`);
    shutdown(1);
  });
  process.on('unhandledRejection', (err) => log.error(`Promesa rechazada sin gestionar: ${String(err)}`));
}

main();
