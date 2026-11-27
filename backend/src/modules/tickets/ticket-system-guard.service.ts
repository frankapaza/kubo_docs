import { ConflictException, Injectable } from '@nestjs/common';

import { ClientSystemsRepository } from './client-systems.repository';
import { isInternalTicketOrigin } from './entities/ticket.entity';
import { TicketsRepository } from './tickets.repository';

/**
 * «Sistema antes de trabajar» (spec 2026-11-27-sistema-obligatorio). Un ticket
 * sin sistema es invisible para el conector MCP, cuyas claves van atadas a un
 * sistema. No se exige al crear (el correo o WhatsApp no lo traen), sino cuando
 * una persona lo toma, asigna, escala, mueve o concluye.
 *
 * Se llama desde las acciones de personas (controlador y conector), nunca desde
 * los servicios: así las transiciones automáticas —el cliente que responde a un
 * ticket en espera, el monitoreo— no se bloquean por un dato que falta.
 */
@Injectable()
export class TicketSystemGuard {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly systems: ClientSystemsRepository,
  ) {}

  /** 409 `SISTEMA_REQUERIDO` si el ticket no tiene sistema y su cliente sí tiene sistemas activos. */
  async assertCanWork(ticketId: number, accion: string): Promise<void> {
    const t = await this.tickets.findById(ticketId);
    // Inexistente: que responda el servicio con su 404 de siempre.
    if (!t || t.systemId !== null && t.systemId !== undefined) return;
    if (isInternalTicketOrigin(t.origin)) return;
    if (t.clientId === null || t.clientId === undefined) return;
    const active = await this.systems.listActiveByClient(Number(t.clientId));
    if (active.length === 0) return;
    throw new ConflictException({
      code: 'SISTEMA_REQUERIDO',
      message: `Asigna el sistema del ticket antes de ${accion}.`,
    });
  }
}
