import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { Ticket } from './entities/ticket.entity';

/** Lo que viaja al panel cuando entra un ticket: lo justo para el aviso. */
export interface TicketCreatedPayload {
  id: number;
  code: string | null;
  subject: string | null;
  priority: string;
  origin: string;
}

const STAFF_ROOM = 'staff';

/**
 * Avisos en vivo de la mesa de servicio al panel del personal.
 *
 * Dos mensajes, nada más:
 * - `ticket:created` — entró un ticket (panel, portal o correo: todos pasan
 *   por `TicketsService.create`). El panel lo muestra como notificación.
 * - `tickets:changed` — algo cambió en la bandeja; el panel recarga la lista.
 *   No lleva el ticket: así la bandeja sigue leyendo del mismo endpoint, con
 *   sus filtros y su decorado de SLA, en vez de mantener una segunda copia.
 *
 * El path va bajo `/api/` para que Caddy lo enrute al backend con la misma
 * regla que la API REST (`/api/*`), sin tocar el Caddyfile.
 *
 * Solo personal: se valida el access token con `JWT_ACCESS_SECRET` -- el del
 * portal usa otro secreto y no pasa -- y, igual que `StaffOnlyGuard`, se
 * rechaza cualquier payload que traiga identidad de cliente. Un aviso de
 * ticket nuevo lleva el asunto, que no debe ver otra empresa.
 */
@WebSocketGateway({ path: '/api/socket.io', namespace: '/tickets' })
export class TicketsRealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TicketsRealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token;
    if (typeof token !== 'string' || !token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        secret: this.cfg.get<string>('JWT_ACCESS_SECRET', 'change-me'),
      });
      if (payload.clientId !== undefined || payload.clientUserId !== undefined) {
        client.disconnect(true);
        return;
      }
      await client.join(STAFF_ROOM);
    } catch {
      // Token vencido o inválido: el panel reconecta con uno renovado.
      client.disconnect(true);
    }
  }

  notifyCreated(ticket: Ticket): void {
    const payload: TicketCreatedPayload = {
      id: ticket.id,
      code: ticket.code,
      subject: ticket.subject,
      priority: ticket.priority,
      origin: ticket.origin,
    };
    this.emit('ticket:created', payload);
    this.notifyChanged();
  }

  notifyChanged(): void {
    this.emit('tickets:changed', {});
  }

  /**
   * Un aviso en vivo nunca debe tumbar la operación que lo origina: el ticket
   * ya está guardado. Si el servidor de sockets aún no está montado (tests,
   * arranque) o falla, se registra y se sigue.
   */
  private emit(event: string, data: unknown): void {
    try {
      this.server?.to(STAFF_ROOM).emit(event, data);
    } catch (e) {
      this.logger.warn(`No se pudo emitir ${event}: ${(e as Error).message}`);
    }
  }
}
