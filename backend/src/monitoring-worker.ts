import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AvailabilityWorkerModule } from './modules/availability/availability-worker.module';

const logger = new Logger('MonitoringWorker');

// Un rechazo suelto no debe tumbar la sonda 24/7: se registra y se sigue.
process.on('unhandledRejection', (e) => logger.error(`Rechazo no gestionado: ${String(e)}`));
// Estado indefinido tras una excepción no capturada: se registra y se sale; `restart: unless-stopped` lo levanta.
process.on('uncaughtException', (e) => {
  logger.error(`Excepción no capturada: ${e.stack ?? e}`);
  process.exit(1);
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AvailabilityWorkerModule);
  app.enableShutdownHooks();
  logger.log('Monitor worker iniciado (kubo-01)');
}

bootstrap().catch((e) => {
  logger.error(`El worker no pudo arrancar: ${(e as Error).message}`);
  process.exit(1);
});
