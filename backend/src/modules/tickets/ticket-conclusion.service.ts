import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { TicketsRepository } from './tickets.repository';
import { TicketAssignmentService } from './ticket-assignment.service';
import { TicketTransitionsService } from './ticket-transitions.service';
import { Ticket } from './entities/ticket.entity';

export interface ConcludeInput {
  ticketId: number;
  actorUserId: number;
  /** Observación general: queda como solución aplicada. */
  solucion: string;
  rootCause?: string;
  correctiveAction?: string;
}

const SIN_REGISTRAR = 'Sin registrar (cierre en lote; ver solución).';

/**
 * Da por concluido un ticket ya atendido: lo lleva por el camino normal
 * (asignado → en atención → resuelto → cerrado) en vez de cerrarlo como
 * cancelado. Cada paso pasa por los servicios de siempre, así el historial,
 * el SLA y los avisos quedan igual que si se hiciera a mano.
 *
 * Los pasos no van en una sola transacción: si uno falla, el ticket queda en
 * el último estado alcanzado y volver a concluirlo sigue desde ahí.
 */
@Injectable()
export class TicketConclusionService {
  constructor(
    private readonly repo: TicketsRepository,
    private readonly assignment: TicketAssignmentService,
    private readonly transitions: TicketTransitionsService,
  ) {}

  async conclude(input: ConcludeInput): Promise<Ticket> {
    const solucion = input.solucion?.trim();
    if (!solucion) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Escribe la observación con la que se concluye.' });
    }
    let t = await this.repo.findById(input.ticketId);
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
    if (t.status === 'CERRADO') {
      throw new BadRequestException({ code: 'INVALID_TRANSITION', message: 'El ticket ya está cerrado.' });
    }

    const base = { ticketId: input.ticketId, actorUserId: input.actorUserId };

    if (t.status === 'NUEVO' || t.status === 'TRIAJE') {
      t = await this.assignment.assign({
        ...base,
        assigneeUserId: t.assigneeUserId != null ? Number(t.assigneeUserId) : input.actorUserId,
      });
    }
    if (t.status === 'ASIGNADO' || t.status === 'DERIVADO') {
      t = await this.transitions.transition({ ...base, toStatus: 'EN_ATENCION' });
    }
    if (t.status === 'EN_ATENCION' || t.status === 'ESPERA_CLIENTE') {
      t = await this.transitions.transition({
        ...base,
        toStatus: 'RESUELTO',
        resolutionMd: solucion,
        rootCause: input.rootCause?.trim() || SIN_REGISTRAR,
        correctiveAction: input.correctiveAction?.trim() || SIN_REGISTRAR,
      });
    }
    return this.transitions.transition({ ...base, toStatus: 'CERRADO' });
  }
}
