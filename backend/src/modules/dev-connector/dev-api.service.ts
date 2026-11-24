import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { TicketAttachmentsService } from '../ticket-messages/ticket-attachments.service';
import { TicketMessagesService } from '../ticket-messages/ticket-messages.service';
import { TicketStatus } from '../tickets/domain/ticket-state-machine';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketTransitionsService } from '../tickets/ticket-transitions.service';
import { WorkItemStatus } from '../work-items/domain/work-item-board';
import { WorkItem } from '../work-items/entities/work-item.entity';
import { WorkItemBoardService } from '../work-items/work-item-board.service';
import { WorkItemEventsService } from '../work-items/work-item-events.service';
import { DevConnectorRepository, OpenItemRow } from './dev-connector.repository';
import { DevPrincipal } from './dev-keys.service';
import { ItemKind, agentTargets, canAgentTransition, normalizeCode, priorityRank } from './domain/dev-rules';
import { DevLinkKind } from './entities/dev-link.entity';

export const MAX_PENDIENTES = 50;

const NOT_FOUND = { code: 'NOT_FOUND', message: 'No existe en este cliente y sistema.' } as const;

export interface PendienteView {
  tipo: 'TICKET' | 'REQUERIMIENTO';
  codigo: string;
  titulo: string;
  estado: string;
  prioridad: string;
  asignado: string | null;
  esMio: boolean;
  vence: string | null;
}

export interface MensajeView {
  fecha: string;
  autor: 'EQUIPO' | 'CLIENTE';
  visibilidad: 'PUBLICA' | 'INTERNA';
  texto: string;
}

export interface ItemView {
  tipo: 'TICKET' | 'REQUERIMIENTO';
  codigo: string;
  titulo: string;
  estado: string;
  prioridad: string;
  esMio: boolean;
  descripcion: string | null;
  criteriosAceptacion: string[];
  vence: string | null;
  conversacion: MensajeView[];
  adjuntos: Array<{ nombre: string; tamanoBytes: number }>;
  codigoVinculado: Array<{ tipo: DevLinkKind; ref: string; titulo: string | null; url: string | null; estado: string | null }>;
  /** Solo tickets. */
  modulo?: string | null;
  pantalla?: string | null;
  tipoSolicitud?: string | null;
  textoOriginal?: string;
}

type Resolved = { kind: 'KB'; ticket: Ticket } | { kind: 'RQ'; item: WorkItem };

/**
 * Lo que el MCP puede hacer, ya acotado a la asignación de la clave.
 *
 * Todo pasa por los servicios de siempre (hilo, transiciones, tablero): los
 * eventos, el SLA, los avisos y el socket en vivo se comportan igual que desde
 * la web. Aquí solo se decide el alcance y la lista blanca.
 */
@Injectable()
export class DevApiService {
  constructor(
    private readonly data: DevConnectorRepository,
    private readonly messages: TicketMessagesService,
    private readonly attachments: TicketAttachmentsService,
    private readonly transitions: TicketTransitionsService,
    private readonly board: WorkItemBoardService,
    private readonly wiEvents: WorkItemEventsService,
  ) {}

  contexto(p: DevPrincipal) {
    return {
      cliente: p.clientName,
      sistema: p.systemName,
      repositorio: p.repoFullName,
      usuario: p.userName,
    };
  }

  async pendientes(p: DevPrincipal): Promise<{ cliente: string; sistema: string; total: number; items: PendienteView[] }> {
    const rows = await this.data.listOpenItems(p.clientSystemId);
    const sorted = [...rows].sort((a, b) => compare(a, b, p.userId));
    return {
      cliente: p.clientName,
      sistema: p.systemName,
      total: rows.length,
      items: sorted.slice(0, MAX_PENDIENTES).map((r) => ({
        tipo: r.tipo,
        codigo: r.codigo,
        titulo: r.titulo,
        estado: r.estado,
        prioridad: r.prioridad,
        asignado: r.asignado ?? null,
        esMio: isMine(r.assigneeUserId, p.userId),
        vence: r.vence,
      })),
    };
  }

  async item(p: DevPrincipal, rawCode: string): Promise<ItemView> {
    const r = await this.resolve(p, rawCode);
    const staff = { kind: 'STAFF' as const, userId: p.userId };

    if (r.kind === 'KB') {
      const t = r.ticket;
      const [thread, files, links] = await Promise.all([
        this.messages.listThread(staff, t.id),
        this.attachments.list(staff, t.id),
        this.data.listLinks({ ticketId: Number(t.id) }),
      ]);
      return {
        tipo: 'TICKET',
        codigo: t.code!,
        titulo: t.subject ?? t.rawText.slice(0, 120),
        estado: t.status,
        prioridad: t.priority,
        esMio: isMine(t.assigneeUserId, p.userId),
        descripcion: t.descriptionMd,
        criteriosAceptacion: t.acceptanceCriteria ?? [],
        vence: iso(t.slaResolutionDueAt),
        modulo: t.moduleName,
        pantalla: t.screenName,
        tipoSolicitud: t.requestType,
        textoOriginal: t.rawText,
        conversacion: thread.map((m) => ({
          fecha: iso(m.createdAt)!,
          autor: m.authorClientUserId ? 'CLIENTE' : 'EQUIPO',
          visibilidad: m.visibility,
          texto: m.bodyMd,
        })),
        adjuntos: files.map((f) => ({ nombre: f.filename, tamanoBytes: f.size })),
        codigoVinculado: links.map(linkView),
      };
    }

    const w = r.item;
    const [events, links] = await Promise.all([
      this.wiEvents.listByItem(Number(w.id)),
      this.data.listLinks({ workItemId: Number(w.id) }),
    ]);
    return {
      tipo: 'REQUERIMIENTO',
      codigo: w.code!,
      titulo: w.title,
      estado: w.status,
      prioridad: w.priority,
      esMio: isMine(w.assigneeUserId, p.userId),
      descripcion: w.descriptionMd,
      criteriosAceptacion: w.acceptanceCriteria ?? [],
      vence: w.dueDate ?? null,
      conversacion: events
        .filter((e) => e.type === 'COMMENT' && e.reason)
        .map((e) => ({
          fecha: iso(e.createdAt)!,
          autor: e.actorClientUserId ? 'CLIENTE' : 'EQUIPO',
          visibilidad: 'INTERNA' as const,
          texto: e.reason!,
        })),
      adjuntos: [],
      codigoVinculado: links.map(linkView),
    };
  }

  /** Nota que el cliente no ve. Se permite en cualquier ítem del alcance, sea de quien sea. */
  async nota(p: DevPrincipal, rawCode: string, texto: string): Promise<{ ok: true }> {
    const body = String(texto ?? '').trim();
    if (!body) throw new BadRequestException({ code: 'BAD_INPUT', message: 'La nota está vacía.' });
    const r = await this.resolve(p, rawCode);
    if (r.kind === 'KB') {
      await this.messages.post({ kind: 'STAFF', userId: p.userId }, r.ticket.id, {
        bodyMd: `${body}\n\n_— vía Claude (${p.repoFullName})_`,
        visibility: 'INTERNA',
      });
    } else {
      await this.wiEvents.record({
        workItemId: Number(r.item.id),
        type: 'COMMENT',
        actorUserId: p.userId,
        reason: body,
        payload: { via: 'claude' },
      });
    }
    return { ok: true };
  }

  /** Solo la lista blanca y solo sobre lo asignado al dueño de la clave (spec §4.1). */
  async estado(p: DevPrincipal, rawCode: string, rawTarget: string): Promise<{ codigo: string; estado: string }> {
    const r = await this.resolve(p, rawCode);
    const target = String(rawTarget ?? '').trim().toUpperCase();
    const kind: ItemKind = r.kind;
    const from = r.kind === 'KB' ? r.ticket.status : r.item.status;
    const assignee = r.kind === 'KB' ? r.ticket.assigneeUserId : r.item.assigneeUserId;

    if (!isMine(assignee, p.userId)) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Este ítem no está asignado a ti: tómalo o pide que te lo asignen en DevDocs.',
      });
    }
    if (!canAgentTransition(kind, from, target)) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Desde Claude no se puede pasar de ${from} a ${target}. Permitido: ${agentTargets(kind).join(', ')} (según el estado actual). Resolver o cerrar se hace en DevDocs.`,
      });
    }

    if (r.kind === 'KB') {
      const t = await this.transitions.transition({
        ticketId: Number(r.ticket.id),
        actorUserId: p.userId,
        toStatus: target as TicketStatus,
      });
      return { codigo: r.ticket.code!, estado: t.status };
    }
    const w = await this.board.move({
      workItemId: Number(r.item.id),
      actorUserId: p.userId,
      toStatus: target as WorkItemStatus,
      toIndex: 0,
    });
    return { codigo: r.item.code!, estado: w.status };
  }

  async vincular(
    p: DevPrincipal,
    rawCode: string,
    v: { kind: DevLinkKind; ref: string; title?: string; url?: string },
  ): Promise<{ ok: true }> {
    const r = await this.resolve(p, rawCode);
    await this.data.upsertLink({
      devRepoId: p.repoId,
      ticketId: r.kind === 'KB' ? Number(r.ticket.id) : null,
      workItemId: r.kind === 'RQ' ? Number(r.item.id) : null,
      kind: v.kind,
      ref: v.ref.trim(),
      title: v.title?.trim() || null,
      url: v.url?.trim() || null,
      authorLogin: null,
      // El estado del PR lo sabe el webhook; null deja el que ya hubiera (merged/closed).
      state: null,
      source: 'MCP',
      occurredAt: new Date(),
    });
    return { ok: true };
  }

  /** Código → ítem de la asignación de la clave. Mal formado, inexistente o ajeno: el mismo 404. */
  private async resolve(p: DevPrincipal, rawCode: string): Promise<Resolved> {
    const n = normalizeCode(rawCode);
    if (!n) throw new NotFoundException({ ...NOT_FOUND });
    if (n.kind === 'KB') {
      const t = await this.data.findTicketByCode(n.code);
      if (!t || Number(t.systemId) !== Number(p.clientSystemId) || t.archivedAt) {
        throw new NotFoundException({ ...NOT_FOUND });
      }
      return { kind: 'KB', ticket: t };
    }
    const w = await this.data.findWorkItemByCode(n.code);
    if (!w || w.clientSystemId == null || Number(w.clientSystemId) !== Number(p.clientSystemId)) {
      throw new NotFoundException({ ...NOT_FOUND });
    }
    return { kind: 'RQ', item: w };
  }
}

function isMine(assignee: number | null | undefined, userId: number): boolean {
  return assignee != null && Number(assignee) === Number(userId);
}

function compare(a: OpenItemRow, b: OpenItemRow, userId: number): number {
  const mine = Number(isMine(b.assigneeUserId, userId)) - Number(isMine(a.assigneeUserId, userId));
  if (mine !== 0) return mine;
  const prio = priorityRank(a.prioridad) - priorityRank(b.prioridad);
  if (prio !== 0) return prio;
  // Sin vencimiento al final.
  if (a.vence !== b.vence) {
    if (!a.vence) return 1;
    if (!b.vence) return -1;
    return a.vence < b.vence ? -1 : 1;
  }
  return a.codigo < b.codigo ? -1 : 1;
}

function iso(d: Date | string | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

function linkView(l: { kind: DevLinkKind; ref: string; title: string | null; url: string | null; state: string | null }) {
  return { tipo: l.kind, ref: l.ref, titulo: l.title, url: l.url, estado: l.state };
}
