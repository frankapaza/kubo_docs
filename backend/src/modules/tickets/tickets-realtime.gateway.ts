import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { parseLogFilter } from '../monitoring/domain/log-filter';
import {
  LiveBudget,
  LiveLogLine,
  matchesLogFilter,
  takeLiveBudget,
} from '../monitoring/domain/live-tail';
import { Ticket } from './entities/ticket.entity';

/** Lo que viaja al panel cuando aparece (o reaparece) un grupo de errores. */
export interface ErrorNewPayload {
  id: number;
  title: string;
  aplicativo: string;
  clienteNombre: string | null;
  reopened: boolean;
  reason: string | null;
}

/** Lo que viaja al panel cuando entra un ticket: lo justo para el aviso. */
export interface TicketCreatedPayload {
  id: number;
  code: string | null;
  subject: string | null;
  priority: string;
  origin: string;
}

const STAFF_ROOM = 'staff';
/** Quienes miran la pantalla de logs en vivo (siempre además en `staff`). */
const LOGS_ROOM = 'logs-live';

/**
 * Avisos en vivo de la mesa de servicio al panel del personal.
 *
 * Mensajes hacia el panel (siempre solo a la sala `staff`):
 * - `ticket:created` — entró un ticket (panel, portal o correo: todos pasan
 *   por `TicketsService.create`). El panel lo muestra como notificación.
 * - `tickets:changed` — algo cambió en la bandeja; el panel recarga la lista.
 *   No lleva el ticket: así la bandeja sigue leyendo del mismo endpoint, con
 *   sus filtros y su decorado de SLA, en vez de mantener una segunda copia.
 * - `error:new` — un grupo de errores nuevo o reabierto (aviso con lo justo).
 * - `errors:changed` — la lista de errores cambió; el panel la recarga.
 * - `monitoreo:disco` — el disco de logs superó el umbral.
 * - `logs:lines` — líneas en vivo, solo a quien mandó `logs:subscribe`, ya
 *   filtradas con SU filtro y con tope de 200 por segundo (`omitidas` cuenta
 *   el exceso).
 * Del cliente: `logs:subscribe` (con filtro) y `logs:unsubscribe`. La
 * suscripción se pierde al reconectar: la pantalla la reenvía en cada
 * `connect`. Un subscribe que llega antes de que el handshake asíncrono meta
 * al socket en `staff` se ignora, para que nadie sin autenticar reciba logs.
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

  notifyErrorNew(p: ErrorNewPayload): void {
    this.emit('error:new', p);
    this.notifyErrorsChanged();
  }

  notifyErrorsChanged(): void {
    this.emit('errors:changed', {});
  }

  notifyDiskAlert(p: { usedPct: number; threshold: number }): void {
    this.emit('monitoreo:disco', p);
  }

  @SubscribeMessage('logs:subscribe')
  subscribeLogs(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): { ok: boolean } {
    // El handshake es asíncrono: hasta que `staff` está puesta, el socket no
    // está autenticado. Se ignora y la web reenvía al reconectar.
    if (!client.rooms?.has(STAFF_ROOM)) return { ok: false };
    client.data.logFilter = parseLogFilter(raw);
    client.data.liveBudget = undefined;
    void Promise.resolve(client.join(LOGS_ROOM)).catch(() => undefined);
    return { ok: true };
  }

  @SubscribeMessage('logs:unsubscribe')
  unsubscribeLogs(@ConnectedSocket() client: Socket): { ok: true } {
    void Promise.resolve(client.leave(LOGS_ROOM)).catch(() => undefined);
    return { ok: true };
  }

  /**
   * Reparte las líneas a cada socket según SU filtro y SU presupuesto. Se
   * recorre `server.sockets` (no se emite a la sala) porque cada socket recibe
   * un subconjunto distinto; se exige además `staff` por si una sala se
   * contaminara. Nunca lanza: la ingesta ya guardó el lote.
   */
  publishLogLines(lines: LiveLogLine[], now: number = Date.now()): void {
    try {
      // Con `namespace` en el decorador, `server` es en realidad el Namespace:
      // su `sockets` es un Map (el tipo Server lo declara como otro Namespace).
      const sockets = (this.server as unknown as { sockets?: Map<string, Socket> })?.sockets;
      if (!sockets || lines.length === 0) return;
      for (const socket of sockets.values()) {
        try {
          if (!socket.rooms.has(LOGS_ROOM) || !socket.rooms.has(STAFF_ROOM)) continue;
          const mine = lines.filter((l) => matchesLogFilter(socket.data.logFilter ?? {}, l));
          if (mine.length === 0) continue;
          const { budget, allowed } = takeLiveBudget(
            socket.data.liveBudget as LiveBudget | undefined,
            mine.length,
            now,
          );
          socket.data.liveBudget = budget;
          socket.emit('logs:lines', {
            lines: mine.slice(0, allowed),
            omitidas: mine.length - allowed,
          });
        } catch (e) {
          this.logger.warn(`No se pudo emitir logs:lines: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.warn(`No se pudo emitir logs:lines: ${(e as Error).message}`);
    }
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
