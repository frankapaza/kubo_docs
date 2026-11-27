import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LLMService } from '../ai/llm.service';
import { ClientsService } from '../clients/clients.service';
import { emailCallout } from '../email/email-layout';
import { EmailService } from '../email/email.service';
import { escapeHtml } from '../notifications/domain/template-renderer';
import { ClientUsersRepository } from '../portal/client-users.repository';
import { WorkItem } from '../work-items/entities/work-item.entity';
import { WorkItemDocView, WorkItemDocumentsService } from '../work-items/work-item-documents.service';
import { WorkItemIntakeService } from '../work-items/work-item-intake.service';
import { WorkItemsService } from '../work-items/work-items.service';
import { buildSpecPrompt, splitSpecResponse } from './domain/requirement-spec';

export interface DetailRequestResult {
  item: WorkItem;
  /** Si le llegó el correo a quien pidió el requerimiento. */
  notified: boolean;
  emailError?: string;
}

export interface SpecDraftResult {
  especificacion: WorkItemDocView;
  /** Solo en proyectos nuevos: el texto para pegar en la IA de diseño. */
  brief: string | null;
  briefDoc: WorkItemDocView | null;
  preguntas: string[];
}

/**
 * Lo que ayuda a que un requerimiento llegue bien explicado: devolverlo al
 * cliente con una pregunta y redactar la Especificación con la IA.
 */
@Injectable()
export class RequirementDetailService {
  private readonly logger = new Logger(RequirementDetailService.name);

  constructor(
    private readonly intake: WorkItemIntakeService,
    private readonly items: WorkItemsService,
    private readonly clientUsers: ClientUsersRepository,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly clients: ClientsService,
    @InjectDataSource() private readonly data: DataSource,
    private readonly llm: LLMService,
    private readonly docs: WorkItemDocumentsService,
  ) {}

  /** Pasa a FALTA_INFO y, si lo pidió un usuario del cliente, se lo avisa por correo. */
  async requestDetail(id: number, actorUserId: number, message: string): Promise<DetailRequestResult> {
    const item = await this.intake.requestDetail(id, actorUserId, message);
    if (item.createdByClientUserId == null) return { item, notified: false };

    const user = await this.clientUsers.findById(Number(item.createdByClientUserId));
    if (!user || !Number(user.isActive) || !user.email) return { item, notified: false };

    const code = item.code ?? `RQ-${item.id}`;
    const base = (this.config.get<string>('FRONTEND_URL') || '').trim().replace(/\/+$/, '') || 'http://localhost:5173';
    const link = `${base}/portal/requerimientos/${Number(item.id)}`;
    try {
      await this.email.send({
        to: user.email,
        subject: `${code}: necesitamos más detalle de tu requerimiento`,
        html: [
          `<p>Hola ${escapeHtml(user.fullName)}:</p>`,
          `<p>Para evaluar tu requerimiento <strong>${escapeHtml(code)} · ${escapeHtml(item.title)}</strong> necesitamos un poco más de detalle:</p>`,
          `<blockquote style="border-left:4px solid #053777;background:#f7f9fc;margin:0 0 6px;padding:10px 14px;color:#33414d;border-radius:6px">${escapeHtml(message.trim()).replace(/\n/g, '<br>')}</blockquote>`,
          emailCallout('Completa tu requerimiento', 'Agrega el detalle desde el portal; apenas lo tengamos seguimos con la evaluación.', {
            href: link,
            label: 'Completar en el portal',
          }),
          '<p>Gracias,<br>Equipo Kubo</p>',
        ].join('\n'),
        text: `Para evaluar ${code} · ${item.title} necesitamos más detalle:\n\n${message.trim()}\n\nCompleta el requerimiento en ${link}`,
      });
      return { item, notified: true };
    } catch (e) {
      this.logger.error(`No se pudo avisar al cliente del pedido de detalle de ${code}.`, e as Error);
      return {
        item,
        notified: false,
        emailError: 'La pregunta quedó registrada, pero no se pudo enviar el correo. El cliente la verá en el portal.',
      };
    }
  }

  /**
   * Redacta la Especificación con el proveedor de IA activo y la guarda en
   * Documentos como borrador (alguien la revisa y aprueba). En los proyectos
   * nuevos guarda además el brief de prototipo.
   */
  async draftSpec(id: number, actorUserId: number): Promise<SpecDraftResult> {
    const item = await this.items.findByIdOrFail(id);
    const [client, systemRows] = await Promise.all([
      this.clients.findByIdOrFail(Number(item.clientId)),
      item.clientSystemId != null
        ? this.data.query(
            'SELECT s.name AS name FROM client_systems cs JOIN systems s ON s.id = cs.system_id WHERE cs.id = ?',
            [item.clientSystemId],
          )
        : Promise.resolve([]),
    ]);
    const code = item.code ?? `RQ-${item.id}`;
    const clientDocs = await this.docs.listBySource(Number(item.id), 'CLIENTE');
    const adjuntos = await Promise.all(
      clientDocs.map(async (d) => ({
        nombre: d.filename,
        // Un archivo que no se pueda leer no impide redactar: se nombra y la IA pregunta.
        texto: await this.docs.readText(Number(item.id), d.id).catch(() => null),
      })),
    );
    const prompt = buildSpecPrompt({
      adjuntos,
      codigo: code,
      titulo: item.title,
      cliente: client.razonSocial,
      sistema: (systemRows as Array<{ name: string }>)[0]?.name ?? null,
      tipo: item.requestType ?? null,
      descripcion: item.descriptionMd,
      criterios: item.acceptanceCriteria ?? [],
    });

    const raw = await this.llm.chat(prompt.system, [{ role: 'user', content: prompt.user }]);
    const out = splitSpecResponse(raw ?? '');
    if (!out.especificacion.trim()) {
      throw new BadGatewayException({ code: 'BAD_GATEWAY', message: 'La IA no devolvió la especificación. Inténtalo de nuevo.' });
    }

    const titulo = `${code} · ${item.title}`;
    const especificacion = await this.docs.upload({
      workItemId: Number(item.id),
      actorUserId,
      kind: 'ESPECIFICACION',
      status: 'BORRADOR',
      buffer: await this.docs.renderManualPdf(titulo, out.especificacion, 'Especificación del requerimiento (borrador generado con IA)'),
      filename: `${code} - Especificación.pdf`,
    });

    let briefDoc: WorkItemDocView | null = null;
    if (out.brief && item.requestType === 'PROYECTO') {
      briefDoc = await this.docs.upload({
        workItemId: Number(item.id),
        actorUserId,
        kind: 'OTRO',
        status: 'BORRADOR',
        buffer: await this.docs.renderManualPdf(titulo, out.brief, 'Brief de prototipo'),
        filename: `${code} - Brief de prototipo.pdf`,
      });
    }

    return {
      especificacion,
      brief: item.requestType === 'PROYECTO' ? out.brief : null,
      briefDoc,
      preguntas: out.preguntas,
    };
  }
}
