import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { TicketsRepository } from './tickets.repository';
import { TicketEventsService } from './ticket-events.service';
import { SlaService } from './sla.service';
import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';

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

      // Envolver la escritura de la bandera y el evento en una transacción, para que
      // si el evento falla, la bandera no se escriba y el ticket se reseleccione en
      // el próximo ciclo. El invariante es: si sla_at_risk = 1, hay un evento
      // SLA_AT_RISK en el timeline.
      await this.repo.runInTransaction(async (manager) => {
        const ticketRepo = manager.getRepository(Ticket);
        const eventRepo = manager.getRepository(TicketEvent);

        await ticketRepo.update(ticket.id, { slaAtRisk: 1 });
        await eventRepo.save(
          eventRepo.create({
            ticketId: ticket.id,
            type: 'SLA_AT_RISK',
            actorUserId: null, // el actor es el sistema
            fromStatus: null,
            toStatus: null,
            reason: null,
            payload: {
              priority: ticket.priority,
              resolutionDueAt: ticket.slaResolutionDueAt?.toISOString() ?? null,
            },
          }),
        );
      });
      marked += 1;
    }
    return marked;
  }
}
