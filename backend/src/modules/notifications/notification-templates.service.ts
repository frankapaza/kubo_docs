import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { EmailService } from '../email/email.service';

import { ComposedEmail, composeEmail } from './domain/email-compose';
import { NotificationAudience, sampleValuesFor, validateTemplate } from './domain/template-renderer';
import { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto';
import { NotificationTemplate } from './entities/notification-template.entity';
import { NotificationTemplatesRepository } from './notification-templates.repository';

@Injectable()
export class NotificationTemplatesService {
  constructor(
    private readonly repo: NotificationTemplatesRepository,
    private readonly email: EmailService,
  ) {}

  /** Todas las plantillas, para el panel: activas e inactivas por igual. */
  list(): Promise<NotificationTemplate[]> {
    return this.repo.findAll();
  }

  /** Para quien vaya a componer un correo: solo la plantilla activa de ese aviso. */
  findActive(triggerKey: string, audience: NotificationAudience): Promise<NotificationTemplate | null> {
    return this.repo.findActive(triggerKey, audience);
  }

  /**
   * Edita una plantilla ya sembrada. `audience` nunca sale del `dto`: el
   * tipo ya no lo declara, y este método valida y guarda siempre con
   * `current.audience` -- el público real de la fila --, nunca con lo que
   * llegue en la petición, aunque un cuerpo manipulado lo incluyera.
   *
   * Se valida tanto `subject` como `bodyMd` (el que cambie, y también el que
   * no, porque los dos se componen en el correo) contra ese público, con
   * `validateTemplate`. Es donde la regla de fuga se hace cumplir: una
   * plantilla de CLIENT con `{{motivo}}` -- en el asunto o en el cuerpo --
   * no se guarda.
   */
  async update(
    id: number,
    staffUserId: number,
    dto: UpdateNotificationTemplateDto,
  ): Promise<NotificationTemplate> {
    const current = await this.findByIdOrFail(id);

    const subject = dto.subject ?? current.subject;
    const bodyMd = dto.bodyMd ?? current.bodyMd;

    this.assertValid(subject, current.audience, 'el asunto');
    this.assertValid(bodyMd, current.audience, 'el cuerpo');

    const patch: Partial<NotificationTemplate> = { updatedBy: staffUserId };
    if (dto.subject !== undefined) patch.subject = dto.subject;
    if (dto.bodyMd !== undefined) patch.bodyMd = dto.bodyMd;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive ? 1 : 0;

    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  /**
   * El asunto y el cuerpo compuestos con datos de ejemplo (`sampleValuesFor`),
   * por el mismo camino -- `composeEmail` -- que usa `NotificationDispatcher`
   * para el envío real. No envía nada: no toca `EmailService` en absoluto. Es
   * a propósito que use el mismo camino de composición y no uno propio: una
   * previsualización que compusiera distinto dejaría de enseñar cómo va a
   * quedar el correo de verdad, que es lo único que se le pide.
   */
  async preview(id: number): Promise<ComposedEmail> {
    const template = await this.findByIdOrFail(id);
    return composeEmail(template, template.audience, sampleValuesFor(template.audience));
  }

  /**
   * Manda el correo de ejemplo de una plantilla a `to`, tal cual lo reciba.
   *
   * Este método no resuelve ningún destinatario propio -- ni el autor del
   * ticket, ni el buzón del equipo -- porque no hay ticket real detrás: el
   * único candidato a destinatario es el parámetro `to`. La regla de "solo al
   * usuario que hace la petición" la impone quien llama (el controlador, con
   * el correo del token), no esta función; pero al no tener ninguna otra
   * fuente de destinatario, tampoco tiene por dónde filtrarse uno distinto.
   */
  async sendTest(id: number, to: string): Promise<{ to: string }> {
    const template = await this.findByIdOrFail(id);
    const { subject, html, text } = composeEmail(
      template,
      template.audience,
      sampleValuesFor(template.audience),
    );
    await this.email.send({ to, subject, html, text });
    return { to };
  }

  /**
   * Distingue en el mensaje una variable "del otro público" (fuga de datos:
   * la plantilla vería algo que su lector no debe ver) de una "que no existe
   * en ningún público" (casi siempre una errata) -- son errores distintos y
   * el editor del panel debe explicarlos distinto.
   */
  private assertValid(text: string, audience: NotificationAudience, field: string): void {
    const result = validateTemplate(text, audience);
    if (result.ok) return;

    const partes: string[] = [];
    if (result.wrongAudience.length > 0) {
      partes.push(
        `${field} usa ${result.wrongAudience.length === 1 ? 'una variable' : 'variables'} ` +
          `del otro público, que este destinatario no puede ver: ${result.wrongAudience.join(', ')}`,
      );
    }
    if (result.unknown.length > 0) {
      partes.push(
        `${field} usa ${result.unknown.length === 1 ? 'una variable' : 'variables'} ` +
          `que no existe${result.unknown.length === 1 ? '' : 'n'} en ningún público: ${result.unknown.join(', ')}`,
      );
    }

    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: `Plantilla inválida: ${partes.join('; ')}.`,
    });
  }

  private async findByIdOrFail(id: number): Promise<NotificationTemplate> {
    const template = await this.repo.findById(id);
    if (!template) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Plantilla de notificación no encontrada',
      });
    }
    return template;
  }
}
