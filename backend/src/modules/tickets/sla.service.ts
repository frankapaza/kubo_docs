import { Injectable } from '@nestjs/common';

import { SlaPoliciesRepository } from './sla-policies.repository';
import { ClientsService } from '../clients/clients.service';
import { SlaPolicy, toSlaMatrix } from './entities/sla-policy.entity';
import { Ticket } from './entities/ticket.entity';
import { TicketPriority } from './domain/ticket-priority';
import {
  SlaMatrix,
  DEFAULT_SLA_MATRIX,
  computeDueDates,
  shiftForPause,
  consumedRatio,
  isAtRisk,
} from './domain/sla.calculator';

@Injectable()
export class SlaService {
  constructor(
    private readonly policies: SlaPoliciesRepository,
    private readonly clients: ClientsService,
  ) {}

  /**
   * Política aplicable: la del cliente, si no la marcada por defecto, y si no
   * hay ninguna en base de datos, la matriz embebida. Un ticket nunca se queda
   * sin reloj de SLA.
   */
  async resolveMatrixForClient(
    clientId: number | null,
  ): Promise<{ policyId: number | null; matrix: SlaMatrix }> {
    let policy: SlaPolicy | null = null;

    if (clientId) {
      const client = await this.clients.findByIdOrFail(clientId);
      if (client.slaPolicyId) {
        policy = await this.policies.findById(client.slaPolicyId);
      }
    }
    if (!policy) policy = await this.policies.findDefault();
    if (!policy) return { policyId: null, matrix: DEFAULT_SLA_MATRIX };

    return { policyId: policy.id, matrix: toSlaMatrix(policy) };
  }

  /** Snapshot de política y vencimientos absolutos al crear el ticket. */
  async initForTicket(input: {
    clientId: number | null;
    createdAt: Date;
    priority: TicketPriority;
  }): Promise<{
    slaPolicyId: number | null;
    slaResponseDueAt: Date | null;
    slaResolutionDueAt: Date | null;
  }> {
    const { policyId, matrix } = await this.resolveMatrixForClient(input.clientId);
    const due = computeDueDates(input.createdAt, input.priority, matrix);
    return {
      slaPolicyId: policyId,
      slaResponseDueAt: due.responseDueAt,
      slaResolutionDueAt: due.resolutionDueAt,
    };
  }

  /**
   * Al salir de ESPERA_CLIENTE. Devuelve el parche a aplicar sobre el ticket.
   * Si no estaba pausado, devuelve los valores sin tocar.
   */
  applyPause(
    ticket: Ticket,
    resumedAt: Date,
  ): {
    pausedTotalSeconds: number;
    slaResponseDueAt: Date | null;
    slaResolutionDueAt: Date | null;
    pausedAt: null;
  } {
    if (!ticket.pausedAt) {
      return {
        pausedTotalSeconds: ticket.pausedTotalSeconds,
        slaResponseDueAt: ticket.slaResponseDueAt,
        slaResolutionDueAt: ticket.slaResolutionDueAt,
        pausedAt: null,
      };
    }

    const shifted = shiftForPause({
      pausedAt: ticket.pausedAt,
      resumedAt,
      responseDueAt: ticket.slaResponseDueAt,
      resolutionDueAt: ticket.slaResolutionDueAt,
    });

    return {
      pausedTotalSeconds: ticket.pausedTotalSeconds + shifted.pausedSeconds,
      slaResponseDueAt: shifted.responseDueAt,
      slaResolutionDueAt: shifted.resolutionDueAt,
      pausedAt: null,
    };
  }

  evaluateRisk(ticket: Ticket, now: Date): boolean {
    if (!ticket.slaResolutionDueAt) return false;
    return isAtRisk({
      now,
      createdAt: ticket.createdAt,
      resolutionDueAt: ticket.slaResolutionDueAt,
      pausedTotalSeconds: ticket.pausedTotalSeconds,
      pausedAt: ticket.pausedAt,
    });
  }

  consumed(ticket: Ticket, now: Date): number | null {
    if (!ticket.slaResolutionDueAt) return null;
    return consumedRatio({
      now,
      createdAt: ticket.createdAt,
      resolutionDueAt: ticket.slaResolutionDueAt,
      pausedTotalSeconds: ticket.pausedTotalSeconds,
      pausedAt: ticket.pausedAt,
    });
  }

  /** Etiqueta legible del reloj para la bandeja y el detalle: «1h 22m», «vencido». */
  remainingLabel(ticket: Ticket, now: Date): string {
    if (!ticket.slaResolutionDueAt) return 'sin SLA';
    if (ticket.pausedAt) return 'en pausa';
    if (ticket.status === 'RESUELTO' || ticket.status === 'CERRADO') return 'cumplido';

    const ms = ticket.slaResolutionDueAt.getTime() - now.getTime();
    if (ms <= 0) return 'vencido';

    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
}
