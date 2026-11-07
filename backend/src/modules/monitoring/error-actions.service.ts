import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { sameId } from '../../common/ids';
import { ClientSystemsRepository } from '../tickets/client-systems.repository';
import { TicketsRealtimeGateway } from '../tickets/tickets-realtime.gateway';
import { TicketsService } from '../tickets/tickets.service';
import { assertCanCreateTicket, assertCanReopen, assertCanResolve } from './domain/error-group-state';
import { buildErrorTicketText } from './domain/error-ticket-text';
import { CreateTicketFromErrorDto } from './dto/error-group.dto';
import { ErrorGroupsRepository } from './error-groups.repository';
import { ErrorGroupsService, ErrorGroupView } from './error-groups.service';

const REOPEN_REASON = 'Reabierto a mano';

/** `FRONTEND_URL` vacío (Compose lo sustituye por cadena vacía) cae al valor de desarrollo. */
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Error no encontrado' };

@Injectable()
export class ErrorActionsService {
  private readonly log = new Logger(ErrorActionsService.name);

  constructor(
    private readonly repo: ErrorGroupsRepository,
    private readonly groups: ErrorGroupsService,
    private readonly tickets: TicketsService,
    private readonly clientSystems: ClientSystemsRepository,
    private readonly gateway: TicketsRealtimeGateway,
    private readonly config: ConfigService,
  ) {}

  /**
   * Crea el ticket interno del error. Orden deliberado (Review Focus 5):
   * 1) validar, 2) RESERVAR el grupo con un UPDATE condicional, 3) crear el
   * ticket, 4) enlazarlo. La reserva va antes porque `TicketsService.create`
   * usa su propia transacción: no se puede abarcar con la del grupo, y sin
   * reserva dos clics simultáneos crearían dos tickets. Si el alta falla
   * (p. ej. «Elige el sistema afectado.») se restaura lo anterior.
   */
  async createTicket(
    id: number,
    actorUserId: number,
    dto: CreateTicketFromErrorDto,
  ): Promise<{ group: ErrorGroupView; ticket: { id: number; code: string } }> {
    const row = await this.repo.findRowById(id);
    if (!row) throw new NotFoundException(NOT_FOUND);
    assertCanCreateTicket(row.status);

    const { clientId, systemId } = await this.resolveAssignment(row.client_id, row.system_id, dto);

    const prev = await this.repo.findReservationState(id);
    if (!prev) throw new NotFoundException(NOT_FOUND);

    const reserved = await this.repo.reserveForTicket(id, actorUserId, new Date());
    if (!reserved) throw new ConflictException({ code: 'CONFLICT', message: 'Este error ya tiene un ticket.' });

    let ticket: { id: number; code: string };
    try {
      const last = (await this.repo.listOccurrences(id, 1))[0] ?? null;
      const text = buildErrorTicketText(
        {
          id,
          title: row.title,
          aplicativo: row.aplicativo,
          logger: row.logger,
          servers: parseServers(row.servers),
          firstSeenAt: new Date(row.first_seen_at),
          lastSeenAt: new Date(row.last_seen_at),
          occurrencesTotal: Number(row.occurrences_total),
        },
        last ? { message: last.message, exception: last.exception ?? null } : null,
        (this.config.get<string>('FRONTEND_URL') || '').trim() || DEFAULT_FRONTEND_URL,
      );
      // Requisito por omisión ('EXIGIDO'): si el cliente tiene sistemas y no
      // hay asignación, el 400 «Elige el sistema afectado.» llega al diálogo.
      const created = await this.tickets.create(
        { kind: 'STAFF', userId: actorUserId },
        {
          rawText: text.rawText,
          subject: text.subject,
          origin: 'MONITOREO',
          requestType: 'INCIDENCIA',
          serviceCategory: 'SOFTWARE',
          clientId: clientId ?? undefined,
          systemId: systemId ?? undefined,
        },
      );
      ticket = { id: Number(created.id), code: created.code ?? "#" + created.id };
    } catch (e) {
      await this.repo.restoreReservation(id, prev).catch((re) => {
        this.log.error(`No se pudo deshacer la reserva del error ${id}: ${(re as Error)?.message ?? re}`);
      });
      throw e;
    }

    // El ticket ya existe: si esto fallara NO se restaura (dejaría un ticket huérfano).
    await this.repo.attachTicket(id, ticket.id);
    this.notifyChanged();
    return { group: await this.groups.detail(id), ticket };
  }

  async resolve(id: number, actorUserId: number, note?: string): Promise<ErrorGroupView> {
    const row = await this.repo.findRowById(id);
    if (!row) throw new NotFoundException(NOT_FOUND);
    assertCanResolve(row.status);
    // Condicional: si otro lo resolvió entre la lectura y aquí, 409 y no se pisa su nota.
    const ok = await this.repo.markResolved(id, actorUserId, note?.trim() || null, new Date());
    if (!ok) assertCanResolve('RESUELTO');
    this.notifyChanged();
    return this.groups.detail(id);
  }

  async reopen(id: number, _actorUserId: number): Promise<ErrorGroupView> {
    const row = await this.repo.findRowById(id);
    if (!row) throw new NotFoundException(NOT_FOUND);
    assertCanReopen(row.status);
    // Reabrir es solo para lo RESUELTO: un CON_TICKET sigue el ciclo de su ticket.
    if (row.status !== 'RESUELTO') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Solo se puede reabrir un error resuelto' });
    }
    const ok = await this.repo.markReopened(id, new Date(), REOPEN_REASON);
    if (!ok) assertCanReopen('NUEVO');
    this.notifyChanged();
    return this.groups.detail(id);
  }

  /**
   * Cliente y asignación del ticket. Un grupo con cliente conserva el suyo (el
   * diálogo no puede cambiarlo); sin cliente, se acepta el elegido. La
   * asignación sale del cliente y producto del grupo si existe; si no, la
   * del cuerpo (que `TicketsService` valida contra las activas del cliente).
   */
  private async resolveAssignment(
    groupClientId: string | number | null,
    groupSystemId: string | number | null,
    dto: CreateTicketFromErrorDto,
  ): Promise<{ clientId: number | null; systemId: number | null }> {
    if (groupClientId !== null && groupClientId !== undefined) {
      if (dto.clientId !== undefined && !sameId(dto.clientId, groupClientId)) {
        throw new BadRequestException({ code: 'BAD_INPUT', message: 'El error ya pertenece a otro cliente.' });
      }
      const clientId = Number(groupClientId);
      if (groupSystemId !== null && groupSystemId !== undefined) {
        const a = await this.clientSystems.findByClientAndSystem(clientId, Number(groupSystemId));
        if (a) return { clientId, systemId: Number(a.id) };
      }
      return { clientId, systemId: dto.systemId ?? null };
    }
    return { clientId: dto.clientId ?? null, systemId: dto.systemId ?? null };
  }

  /** Acción directa de una persona: aviso inmediato, sin el intervalo de la ingesta. */
  private notifyChanged(): void {
    try {
      this.gateway.notifyErrorsChanged();
    } catch (e) {
      this.log.warn(`No se pudo avisar del cambio: ${(e as Error)?.message ?? e}`);
    }
  }
}

/** El driver entrega el JSON ya parseado; se tolera la cadena por si cambia la configuración. */
function parseServers(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v !== 'string') return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}
