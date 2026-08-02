import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { TicketsRepository } from '../tickets/tickets.repository';
import { TicketEventsService } from '../tickets/ticket-events.service';
import { TicketsService } from '../tickets/tickets.service';
import { ClientSystemsRepository } from '../tickets/client-systems.repository';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketEvent } from '../tickets/entities/ticket-event.entity';

import { CreatePortalTicketDto } from './dto/create-portal-ticket.dto';
import {
  PortalClientSystemView,
  PortalTicketEventView,
  PortalTicketView,
} from './dto/portal-ticket.dto';

/**
 * Un ticket que no es del cliente que pregunta y un ticket que no existe se
 * responden con el mismo error. Un 403 confirmaría que el id existe y dejaría
 * enumerar los tickets de las demás empresas a base de probar números.
 */
function ticketNotFound(): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
}

/** bigint de MySQL llega como cadena; el clientId del token es un número. */
function sameId(a: unknown, b: unknown): boolean {
  return a !== null && a !== undefined && Number(a) === Number(b);
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Cara del ticket que ve el cliente. Todo lo que sale del portal pasa por
 * aquí, y `clientId` entra siempre por argumento desde el token — nunca desde
 * el cuerpo, la URL ni la query.
 */
@Injectable()
export class PortalTicketsService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly events: TicketEventsService,
    private readonly ticketsService: TicketsService,
    private readonly systemsRepo: ClientSystemsRepository,
  ) {}

  async list(clientId: number): Promise<PortalTicketView[]> {
    const rows = await this.tickets.list({ clientId });
    return rows.map((t) => this.toPortalView(t));
  }

  async detail(clientId: number, ticketId: number): Promise<PortalTicketView> {
    const ticket = await this.tickets.findById(ticketId);
    // La comprobación de pertenencia va aquí y no en la consulta a propósito:
    // es explícita, y el mismo error cubre "no existe" y "no es tuyo".
    if (!ticket || !sameId(ticket.clientId, clientId)) {
      throw ticketNotFound();
    }

    const timeline = await this.events.listByTicket(Number(ticket.id));
    return { ...this.toPortalView(ticket), timeline: timeline.map((e) => this.toEventView(e)) };
  }

  /**
   * `clientUserId` y `clientId` vienen de la sesión ya validada por
   * `ClientJwtGuard`; el dto solo aporta texto. La escritura entera se delega
   * en `TicketsService.create`, que ya la hace transaccional junto con el
   * evento CREATED: aquí no se abre un segundo camino de escritura.
   */
  async create(
    clientUserId: number,
    clientId: number,
    dto: CreatePortalTicketDto,
  ): Promise<PortalTicketView> {
    const systemId = await this.resolveSystemId(clientId, dto.systemId);

    const ticket = await this.ticketsService.create(
      { kind: 'CLIENT', clientUserId },
      {
        clientId,
        systemId,
        subject: dto.subject,
        rawText: dto.description,
        origin: 'PORTAL',
      },
    );
    return this.toPortalView(ticket);
  }

  async systems(clientId: number): Promise<PortalClientSystemView[]> {
    const rows = await this.systemsRepo.listByClient(clientId);
    return rows.filter((s) => !!s.isActive).map((s) => ({ id: Number(s.id), name: s.name }));
  }

  /**
   * Un systemId que no sea de este cliente sería una referencia cruzada entre
   * empresas escrita desde fuera, así que se valida contra los sistemas
   * activos del cliente del token antes de tocar la base.
   */
  private async resolveSystemId(
    clientId: number,
    systemId: number | undefined,
  ): Promise<number | undefined> {
    if (systemId === undefined || systemId === null) return undefined;
    const allowed = await this.systems(clientId);
    if (!allowed.some((s) => s.id === Number(systemId))) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'El sistema indicado no pertenece a tu empresa.',
      });
    }
    return Number(systemId);
  }

  /**
   * Campo por campo, nunca con spread ni delete: si mañana aparece una
   * columna nueva en `Ticket`, el portal no la publica por defecto.
   */
  private toPortalView(t: Ticket): PortalTicketView {
    return {
      id: Number(t.id),
      code: t.code ?? null,
      subject: t.subject ?? null,
      descriptionMd: t.descriptionMd ?? null,
      status: t.status,
      systemId: toNumberOrNull(t.systemId),
      createdAt: toIso(t.createdAt)!,
      resolvedAt: toIso(t.resolvedAt),
      closedAt: toIso(t.closedAt),
    };
  }

  /** El timeline se muestra sin `reason` ni actor: son datos internos. */
  private toEventView(e: TicketEvent): PortalTicketEventView {
    return {
      type: e.type,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      createdAt: toIso(e.createdAt)!,
    };
  }
}
