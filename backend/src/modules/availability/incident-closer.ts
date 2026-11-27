/**
 * Costura para cerrar incidentes cuando se pausa o archiva un servicio/servidor.
 * La implementa `AvailabilityEvaluatorService` (ver `AvailabilityModule`).
 */
export abstract class IncidentCloser {
  abstract closeForPause(serviceIds: number[], actorUserId: number): Promise<void>;
}
