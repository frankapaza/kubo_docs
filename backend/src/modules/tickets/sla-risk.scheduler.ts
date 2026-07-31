import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { TicketsRepository } from './tickets.repository';
import { TicketEventsService } from './ticket-events.service';
import { SlaService } from './sla.service';

/**
 * Regla 04 del prototipo: al consumir el 70% del plazo de resolución sin
 * actividad, el ticket se marca en riesgo y queda constancia en el timeline.
 *
 * Idempotente: `listOpenForRiskScan` ya excluye los que tienen sla_at_risk = 1,
 * así que el evento nunca se emite dos veces para el mismo ticket.
 */
@Injectable()
export class SlaRiskScheduler {
  private readonly logger = new Logger(SlaRiskScheduler.name);

  constructor(
    private readonly repo: TicketsRepository,
    private readonly events: TicketEventsService,
    private readonly sla: SlaService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron(): Promise<void> {
    try {
      const marked = await this.scan();
      if (marked > 0) this.logger.log(`SLA en riesgo: ${marked} ticket(s) marcados`);
    } catch (err) {
      this.logger.error(`Fallo el escaneo de SLA en riesgo: ${err}`);
    }
  }

  async scan(now: Date = new Date()): Promise<number> {
    const candidates = await this.repo.listOpenForRiskScan();
    let marked = 0;

    for (const ticket of candidates) {
      if (!this.sla.evaluateRisk(ticket, now)) continue;

      await this.repo.update(ticket.id, { slaAtRisk: 1 });
      await this.events.record({
        ticketId: ticket.id,
        type: 'SLA_AT_RISK',
        actorUserId: null, // el actor es el sistema
        payload: {
          priority: ticket.priority,
          resolutionDueAt: ticket.slaResolutionDueAt?.toISOString() ?? null,
        },
      });
      marked += 1;
    }
    return marked;
  }
}
