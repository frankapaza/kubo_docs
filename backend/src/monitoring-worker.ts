import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AvailabilityWorkerModule } from './modules/availability/availability-worker.module';

const logger = new Logger('MonitoringWorker');

// Una excepción suelta no debe tumbar la sonda 24/7: se registra y se sigue.
process.on('unhandledRejection', (e) => logger.error(`Rechazo no gestionado: ${String(e)}`));
process.on('uncaughtException', (e) => logger.error(`Excepción no capturada: ${e.stack ?? e}`));

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AvailabilityWorkerModule);
  app.enableShutdownHooks();
  logger.log('Monitor worker iniciado (kubo-01)');
}

bootstrap().catch((e) => {
  logger.error(`El worker no pudo arrancar: ${(e as Error).message}`);
  process.exit(1);
});
