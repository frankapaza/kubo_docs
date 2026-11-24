import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AvailabilityEvaluatorService } from './availability-evaluator.service';

export const EVALUATOR_TICK_MS = 5000;

/**
 * Ejecuta el tick del evaluador cada 5 s en el backend (el worker solo mide).
 * Nunca hay dos ticks a la vez: si el anterior sigue en curso, el siguiente se
 * salta. Una excepción se registra y no detiene el reloj.
 */
@Injectable()
export class AvailabilityEvaluatorScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AvailabilityEvaluatorScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly evaluator: AvailabilityEvaluatorService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.runTick(), EVALUATOR_TICK_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runTick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.evaluator.tick(new Date());
    } catch (e) {
      this.logger.error(`Tick del evaluador fallido: ${(e as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }
}
