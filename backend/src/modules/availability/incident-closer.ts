import { Injectable, Logger } from '@nestjs/common';

/**
 * Costura para cerrar incidentes cuando se pausa o archiva un servicio/servidor.
 * El evaluador de la Task 9 es quien la implementa de verdad.
 */
export abstract class IncidentCloser {
  abstract closeForPause(serviceIds: number[], actorUserId: number): Promise<void>;
}

// Task 9 lo reemplaza por AvailabilityEvaluatorService
@Injectable()
export class NoopIncidentCloser extends IncidentCloser {
  private readonly logger = new Logger(NoopIncidentCloser.name);

  async closeForPause(serviceIds: number[], actorUserId: number): Promise<void> {
    this.logger.warn(
      `closeForPause sin evaluador: servicios ${serviceIds.join(',')} (actor ${actorUserId}); los incidentes abiertos no se cerraron`,
    );
  }
}
