import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { TicketAttachmentsService } from '../ticket-messages/ticket-attachments.service';
import { TicketMessagesService } from '../ticket-messages/ticket-messages.service';
import { TicketStatus } from '../tickets/domain/ticket-state-machine';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketAssignmentService } from '../tickets/ticket-assignment.service';
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
const ADJUNTO_NOT_FOUND = { code: 'NOT_FOUND', message: 'Ese adjunto no existe en este ticket.' } as const;

/**
 * Cómo empieza un borrador de respuesta escrito por Claude. La web lo reconoce
 * por esta cabecera (copia en `web/src/pages/tickets/thread/claude-draft.ts`)
 * y el texto para el cliente es lo que va después del separador.
 */
export const BORRADOR_CABECERA = '**Borrador de respuesta al cliente**';
export const BORRADOR_SEPARADOR = '---';

const TOMABLES: string[] = ['NUEVO', 'TRIAJE', 'ASIGNADO', 'EN_ATENCION', 'ESPERA_CLIENTE', 'DERIVADO'];

/** Tope para pasar un adjunto a Claude (el JSON en base64 pesa un tercio más). */
export const MAX_ADJUNTO_BYTES = 5 * 1024 * 1024;

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
  adjuntos: Array<{ id: number; nombre: string; tipo: string; tamanoBytes: number }>;
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
    private readonly assignment: TicketAssignmentService,
  ) {}

  /**
   * Asignarse un ticket y ponerlo en atención (el «Tomar» de la web). Solo si
   * está libre o ya es del dueño de la clave: quitárselo a otro es cosa del líder.
   */
  async tomar(p: DevPrincipal, rawCode: string): Promise<{ codigo: string; estado: string }> {
    const t = await this.ticketOnly(p, rawCode, 'tomar');
    const assignee = t.assigneeUserId;
    if (assignee != null && !isMine(assignee, p.userId)) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Este ticket ya está asignado a otra persona: pide que te lo reasignen en DevDocs.',
      });
    }
    if (!TOMABLES.includes(t.status)) {
      throw new ConflictException({ code: 'CONFLICT', message: `Un ticket en ${t.status} no se puede tomar.` });
    }
    if (t.status === 'EN_ATENCION' && isMine(assignee, p.userId)) return { codigo: t.code!, estado: t.status };

    if (t.status === 'NUEVO' || t.status === 'TRIAJE') {
      await this.assignment.assign({
        ticketId: Number(t.id),
        actorUserId: p.userId,
        assigneeUserId: p.userId,
        reason: `Tomado vía Claude (${p.repoFullName})`,
      });
    }
    const out = await this.assignment.take({ ticketId: Number(t.id), actorUserId: p.userId });
    return { codigo: t.code!, estado: out.status };
  }

  /**
   * Resolver con la misma evidencia que exige la web (solución, causa raíz y
   * acción correctiva). Cerrar sigue siendo de una persona: el cliente aún
   * puede confirmar o reabrir.
   */
  async resolver(
    p: DevPrincipal,
    rawCode: string,
    e: { solucion: string; causaRaiz: string; accionCorrectiva: string },
  ): Promise<{ codigo: string; estado: string }> {
    const solucion = String(e?.solucion ?? '').trim();
    const causaRaiz = String(e?.causaRaiz ?? '').trim();
    const accionCorrectiva = String(e?.accionCorrectiva ?? '').trim();
    if (!solucion || !causaRaiz || !accionCorrectiva) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Para resolver hacen falta solución aplicada, causa raíz y acción correctiva.',
      });
    }
    const t = await this.ticketOnly(p, rawCode, 'resolver');
    if (!isMine(t.assigneeUserId, p.userId)) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Este ticket no está asignado a ti: tómalo primero (herramienta tomar_ticket).',
      });
    }
    if (t.status !== 'EN_ATENCION' && t.status !== 'ESPERA_CLIENTE') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Solo se resuelve un ticket en atención o en espera del cliente; este está en ${t.status}.`,
      });
    }
    const out = await this.transitions.transition({
      ticketId: Number(t.id),
      actorUserId: p.userId,
      toStatus: 'RESUELTO',
      resolutionMd: `${solucion}\n\n_— vía Claude (${p.repoFullName})_`,
      rootCause: causaRaiz,
      correctiveAction: accionCorrectiva,
    });
    return { codigo: t.code!, estado: out.status };
  }

  /**
   * La respuesta al cliente, como borrador: una nota INTERNA marcada que en
   * DevDocs se revisa y se envía con «Usar como respuesta». Ningún texto de
   * Claude le llega al cliente sin que una persona lo lea.
   */
  async borrador(p: DevPrincipal, rawCode: string, texto: string): Promise<{ ok: true }> {
    const body = String(texto ?? '').trim();
    if (!body) throw new BadRequestException({ code: 'BAD_INPUT', message: 'El borrador está vacío.' });
    const t = await this.ticketOnly(p, rawCode, 'redactar respuestas');
    if (t.status === 'CERRADO') {
      throw new ConflictException({ code: 'CONFLICT', message: 'El ticket está cerrado: su hilo no admite mensajes.' });
    }
    await this.messages.post({ kind: 'STAFF', userId: p.userId }, t.id, {
      bodyMd: `${BORRADOR_CABECERA} · vía Claude (${p.repoFullName})\n\n${BORRADOR_SEPARADOR}\n\n${body}`,
      visibility: 'INTERNA',
    });
    return { ok: true };
  }

  /** Las tres de arriba solo existen para tickets. */
  private async ticketOnly(p: DevPrincipal, rawCode: string, que: string): Promise<Ticket> {
    const r = await this.resolve(p, rawCode);
    if (r.kind !== 'KB') {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: `Desde Claude solo se puede ${que} en tickets (KB-); los requerimientos se gestionan en DevDocs.`,
      });
    }
    return r.ticket;
  }

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
        adjuntos: files.map((f) => ({ id: Number(f.id), nombre: f.filename, tipo: f.mimeType, tamanoBytes: f.size })),
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

  /**
   * Un adjunto del ticket, en base64, para que Claude lo vea. Solo los de un
   * ticket del alcance de la clave; el id tiene que estar en la lista de ese
   * ticket (la descarga del servicio no comprueba a qué ticket pertenece).
   */
  async adjunto(
    p: DevPrincipal,
    rawCode: string,
    attachmentId: number,
  ): Promise<{ id: number; nombre: string; tipo: string; tamanoBytes: number; base64: string }> {
    const r = await this.resolve(p, rawCode);
    if (r.kind !== 'KB') throw new NotFoundException({ ...ADJUNTO_NOT_FOUND });
    const staff = { kind: 'STAFF' as const, userId: p.userId };
    const meta = (await this.attachments.list(staff, r.ticket.id)).find((f) => Number(f.id) === Number(attachmentId));
    if (!meta) throw new NotFoundException({ ...ADJUNTO_NOT_FOUND });
    if (meta.size > MAX_ADJUNTO_BYTES) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: `El adjunto pasa de ${MAX_ADJUNTO_BYTES / (1024 * 1024)} MB: descárgalo desde DevDocs.`,
      });
    }
    const d = await this.attachments.download(staff, meta.id);
    const chunks: Buffer[] = [];
    for await (const c of d.stream as AsyncIterable<Buffer | string>) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const buf = Buffer.concat(chunks);
    return { id: Number(meta.id), nombre: d.filename, tipo: d.mimeType, tamanoBytes: buf.length, base64: buf.toString('base64') };
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
