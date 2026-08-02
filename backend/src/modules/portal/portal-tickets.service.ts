import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { TicketsRepository } from '../tickets/tickets.repository';
import { TicketEventsService } from '../tickets/ticket-events.service';
import { TicketsService } from '../tickets/tickets.service';
import { ClientSystemsRepository } from '../tickets/client-systems.repository';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketEvent, TicketEventType } from '../tickets/entities/ticket-event.entity';

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

/**
 * Compara dos identificadores por valor.
 *
 * Obligatorio, no defensivo: TypeORM hidrata **toda** columna `bigint` como
 * cadena aunque la entidad la declare `number` (comprobado contra la base:
 * `Ticket.id`, `clientId`, `systemId`, `createdByClientUserId`,
 * `ClientSystem.id`, `ClientUser.id` salen todos como `"13"`, `"1"`…). El
 * tipo de TypeScript miente, así que `===` entre un id del token —un número
 * de verdad— y un id de la base es siempre falso. Con la comparación estricta,
 * el dueño legítimo de un ticket se comería un 404.
 *
 * Los `tinyint` (`isActive`, `isAdmin`, `slaAtRisk`) sí llegan como número; no
 * necesitan este tratamiento.
 *
 * Simétrica a propósito: guardar solo el primer argumento dejaba `Number(null)`
 * → `0` y `Number(undefined)` → `NaN` entrando por el segundo, de modo que un
 * "no hay valor" se convertía en un id comparable. Hoy el segundo siempre
 * llega validado, pero esta es **la** comprobación de pertenencia que sostiene
 * la regla del 404 del portal y no debe depender de quién la llame.
 *
 * Se exporta para poder probarla directamente: por el mismo motivo.
 */
export function sameId(a: unknown, b: unknown): boolean {
  const na = toComparableId(a);
  const nb = toComparableId(b);
  return na !== null && nb !== null && na === nb;
}

/**
 * Un identificador comparable, o `null` si el valor no es uno. Fuera quedan
 * `null`, `undefined`, la cadena vacía (que `Number` convertiría en 0) y todo
 * lo que no dé un número finito.
 */
function toComparableId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Exige que el identificador de la sesión sea un entero positivo antes de
 * usarlo para acotar nada.
 *
 * No es paranoia: `TicketsRepository.list` monta el filtro con
 * `if (filters.clientId) qb.andWhere('t.client_id = :clientId', …)`, así que un
 * `clientId` falsy —`0`, `NaN`, `undefined`— **hace desaparecer el WHERE** y la
 * consulta devuelve hasta 500 tickets de todas las empresas. Ese repositorio lo
 * comparte el panel interno, donde "sin filtro de cliente" es una consulta
 * legítima, así que la forma de fallo no se corrige allí: se corrige aquí, que
 * es donde importa. El portal falla cerrado.
 *
 * Hoy el valor no puede llegar mal —`client_users.client_id` es
 * `bigint unsigned NOT NULL` y el secreto propio del portal impide que un token
 * del personal valide aquí— pero la frontera no debe depender de eso.
 */
function assertSessionScope(value: number, campo: 'clientId' | 'clientUserId'): void {
  if (Number.isInteger(value) && value > 0) return;

  // Qué campo falló va al log, nunca a la respuesta: el cuerpo se queda en el
  // `{ code, message }` de siempre. Si esto salta, es un fallo de programación
  // o un token manipulado, y en ambos casos interesa verlo en el servidor.
  new Logger(PortalTicketsService.name).error(
    `Sesión de portal sin ${campo} utilizable (${String(value)}): se rechaza la petición sin consultar.`,
  );
  throw new UnauthorizedException({
    code: 'UNAUTHORIZED',
    message: 'La sesión no identifica a ninguna empresa.',
  });
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Tipos de evento que el cliente puede ver: el alta y los cambios de estado,
 * que es lo que le cuenta en qué punto va su solicitud.
 *
 * Es una lista **blanca** a propósito, igual que la proyección de campos: un
 * tipo nuevo añadido al enum dentro de seis meses queda oculto por omisión y
 * hay que decidir a conciencia publicarlo. Una lista negra lo publicaría sola.
 *
 * Fuera quedan, y por qué:
 *  - `SLA_AT_RISK`: el portal no ve el SLA. El nombre ya revela que existe una
 *    maquinaria de plazos y que este ticket va mal, aunque no lleve datos.
 *  - `PRIORITY_OVERRIDDEN`: el portal no ve la prioridad, ni que se tocó.
 *  - `ASSIGNED`: mecánica de asignación interna. Además va sin from/to, así
 *    que no aporta ciclo de vida; el `STATUS_CHANGED` a ASIGNADO ya lo cuenta.
 *  - `COMMENT`: pese al nombre no es un comentario para el cliente. Hoy solo
 *    lo escribe TicketAIService como marcador de "empujado a Jira" y
 *    "documento de cierre generado" (ver ticket-ai.service.ts), con el dato
 *    en `payload`, que el portal tampoco publica.
 */
const CLIENT_VISIBLE_EVENT_TYPES: ReadonlySet<TicketEventType> = new Set<TicketEventType>([
  'CREATED',
  'TRIAGED',
  'STATUS_CHANGED',
  'TAKEN',
  'ESCALATED',
  'RESOLVED',
  'REOPENED',
  'CLOSED',
]);

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
    // Antes de consultar, no después: si el `clientId` no sirve para acotar,
    // `TicketsRepository.list` devolvería tickets de todas las empresas.
    assertSessionScope(clientId, 'clientId');
    const rows = await this.tickets.list({ clientId });
    return rows.map((t) => this.toPortalView(t));
  }

  async detail(clientId: number, ticketId: number): Promise<PortalTicketView> {
    assertSessionScope(clientId, 'clientId');
    const ticket = await this.tickets.findById(ticketId);
    // La comprobación de pertenencia va aquí y no en la consulta a propósito:
    // es explícita, y el mismo error cubre "no existe" y "no es tuyo".
    if (!ticket || !sameId(ticket.clientId, clientId)) {
      throw ticketNotFound();
    }

    const timeline = await this.events.listByTicket(Number(ticket.id));
    return {
      ...this.toPortalView(ticket),
      timeline: timeline
        .filter((e) => CLIENT_VISIBLE_EVENT_TYPES.has(e.type))
        .map((e) => this.toEventView(e)),
    };
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
    // Los dos: el `clientId` acota el ticket y el `clientUserId` queda grabado
    // como su autor. Un cero o un NaN aquí crearía una fila huérfana.
    assertSessionScope(clientId, 'clientId');
    assertSessionScope(clientUserId, 'clientUserId');

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
    assertSessionScope(clientId, 'clientId');
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
    // Por `sameId` y no por `===`: aunque `systems()` ya normaliza los ids con
    // `Number`, dejar la comparación colgando de esa normalización remota es
    // justo el descuido que convierte un `bigint` en cadena y rompe el filtro.
    if (!allowed.some((s) => sameId(s.id, systemId))) {
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
      descriptionMd: this.visibleDescription(t),
      status: t.status,
      systemId: toNumberOrNull(t.systemId),
      createdAt: toIso(t.createdAt)!,
      resolvedAt: toIso(t.resolvedAt),
      closedAt: toIso(t.closedAt),
    };
  }

  /**
   * Qué texto ve el cliente como descripción.
   *
   * `description_md` es la versión elaborada (hoy la escribe la IA) y es
   * siempre la preferida. Cuando aún no existe, el ticket abierto desde el
   * portal se quedaría sin descripción: el cliente escribe su problema al
   * darlo de alta, ese texto va a `raw_text`, y el detalle le devolvería null.
   *
   * El respaldo a `rawText` exige las **dos** condiciones a la vez: que el
   * ticket haya nacido en el portal y que tenga un usuario de cliente como
   * autor. Solo entonces el `raw_text` es, con seguridad, lo que escribió el
   * propio cliente. En un ticket de origen NOTE (o EMAIL, o MEETING) el
   * `raw_text` son las palabras internas del equipo o una transcripción sin
   * revisar, y publicarlo sería una fuga. Una sola de las dos condiciones no
   * basta: un ticket marcado PORTAL pero creado por el equipo lo incumpliría.
   *
   * La decisión vive en la lectura y no en la escritura porque es el portal
   * quien elige cómo presenta; `TicketsService.create` lo comparte con el
   * panel interno. Cuando la IA elabore el `description_md`, este respaldo
   * deja de usarse solo.
   */
  private visibleDescription(t: Ticket): string | null {
    if (t.descriptionMd) return t.descriptionMd;
    const loEscribioElCliente =
      t.origin === 'PORTAL' && t.createdByClientUserId !== null && t.createdByClientUserId !== undefined;
    return loEscribioElCliente ? t.rawText ?? null : null;
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
