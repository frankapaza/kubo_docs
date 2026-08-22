import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { WorkspaceService, ResolvedSmtpConfig } from '../workspace/workspace.service';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendEmailInput {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
  /**
   * Cabeceras adicionales, tal cual, sin transformar. Las usa
   * `NotificationDispatcher` para marcar sus envíos como automáticos
   * (`Auto-Submitted`, RFC 3834) y para enlazar el hilo de un ticket nacido de
   * un correo (`In-Reply-To` / `References`), pero este servicio no sabe nada
   * de esas dos cosas: solo las traslada a nodemailer.
   */
  headers?: Record<string, string>;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly workspace: WorkspaceService,
  ) {}

  /**
   * Prioriza la config SMTP de la BD (workspace_settings).
   * Cae al .env como respaldo si la DB no está configurada.
   *
   * Toda variable se lee con `|| valor por defecto`, nunca con `??`: el
   * `docker-compose.yml` de producción declara `SMTP_HOST: ${SMTP_HOST}` y
   * Compose **sustituye por cadena vacía** cuando la variable no está en el
   * `.env`; no omite la clave. Con `??`, una variable en blanco pasaría por
   * "configurada": el puerto saldría `NaN` —el `parseInt` de una cadena
   * vacía— y el `From` iría vacío. Mismo criterio, y por la misma razón, que
   * `resolveFrontendUrl` en el despachador de avisos.
   */
  private async getSmtpConfig(): Promise<ResolvedSmtpConfig> {
    const fromDb = await this.workspace.getSmtpConfig();
    if (fromDb) return fromDb;

    const host = (this.config.get<string>('SMTP_HOST') || '').trim();
    const user = (this.config.get<string>('SMTP_USER') || '').trim();
    const pass = this.config.get<string>('SMTP_PASS') || '';
    // `|| 587` cubre a la vez la cadena vacía y un valor que no sea un número.
    const port = parseInt((this.config.get<string>('SMTP_PORT') || '').trim(), 10) || 587;
    const secure = (this.config.get<string>('SMTP_SECURE') || '').trim() === 'true';
    const from = (this.config.get<string>('SMTP_FROM') || '').trim() || user || 'no-reply@kuboti.com';

    if (!host || !user || !pass) {
      throw new BadGatewayException({
        code: 'EMAIL_NOT_CONFIGURED',
        message:
          'El envío de correo no está configurado. Configúralo en Datos del emisor → SMTP.',
      });
    }
    return { host, port, secure, user, pass, from };
  }

  async send(input: SendEmailInput): Promise<{ messageId: string; accepted: string[]; rejected: string[] }> {
    const cfg = await this.getSmtpConfig();

    // Extraemos la dirección "pura" del campo From (por si viene en formato "Nombre <email@x.com>")
    const fromEmail = this.extractEmail(cfg.from) ?? cfg.user;
    const userEmail = this.extractEmail(cfg.user) ?? cfg.user;

    // Muchos proveedores (Gmail, Office365) exigen que el From coincida con el usuario autenticado.
    // Si no coincide, reescribimos el From usando el user pero manteniendo el display name del from original.
    let effectiveFrom = cfg.from;
    if (fromEmail.toLowerCase() !== userEmail.toLowerCase()) {
      const displayName = this.extractDisplayName(cfg.from);
      effectiveFrom = displayName ? `${displayName} <${userEmail}>` : userEmail;
      this.logger.warn(
        `SMTP From "${cfg.from}" no coincide con el usuario "${cfg.user}". Reescribiendo a "${effectiveFrom}" para evitar rechazo del proveedor.`,
      );
    }

    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });

    this.logger.log(
      `Enviando correo: from="${effectiveFrom}" to="${Array.isArray(input.to) ? input.to.join(',') : input.to}" subject="${input.subject.slice(0, 60)}"`,
    );

    try {
      const info = await transporter.sendMail({
        from: effectiveFrom,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments: input.attachments,
        replyTo: input.replyTo ?? userEmail,
        headers: input.headers,
      });
      this.logger.log(
        `Email OK: messageId=${info.messageId} accepted=${JSON.stringify(info.accepted)} rejected=${JSON.stringify(info.rejected)}`,
      );
      return {
        messageId: info.messageId,
        accepted: (info.accepted ?? []).map(String),
        rejected: (info.rejected ?? []).map(String),
      };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & {
        code?: string;
        command?: string;
        response?: string;
        responseCode?: number;
      };
      this.logger.error(
        `Error enviando email: message="${e.message}" code=${e.code} command=${e.command} response="${e.response}" responseCode=${e.responseCode}`,
      );
      // Mensaje al usuario más informativo
      const details: string[] = [e.message];
      if (e.code) details.push(`Código: ${e.code}`);
      if (e.response) details.push(`Respuesta SMTP: ${e.response}`);
      throw new BadGatewayException({
        code: 'EMAIL_SEND_ERROR',
        message: `No se pudo enviar el correo. ${details.join(' · ')}`,
      });
    }
  }

  /** Saca la dirección de un string formato "Nombre <email@dom.com>" o "email@dom.com". */
  private extractEmail(input: string): string | null {
    const match = input.match(/<([^>]+)>/);
    if (match) return match[1].trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim())) return input.trim();
    return null;
  }

  /** Saca el nombre (lo que está fuera del <email>) de un string "Nombre <email>". */
  private extractDisplayName(input: string): string | null {
    const match = input.match(/^(.+?)\s*<[^>]+>\s*$/);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    return null;
  }

  /**
   * Prueba la conexión SMTP: autentica y envía un correo de ping al mismo usuario.
   * Nota: enviar a sí mismo casi siempre pasa aunque el From esté mal — por eso el
   * `send()` real tiene validación adicional y reescribe el From si hace falta.
   */
  async testConnection(): Promise<{ ok: true; sentTo: string }> {
    const cfg = await this.getSmtpConfig();
    const userEmail = this.extractEmail(cfg.user) ?? cfg.user;
    const fromEmail = this.extractEmail(cfg.from) ?? cfg.user;
    const effectiveFrom =
      fromEmail.toLowerCase() !== userEmail.toLowerCase() ? userEmail : cfg.from;

    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    try {
      await transporter.verify();
      await transporter.sendMail({
        from: effectiveFrom,
        to: userEmail,
        subject: 'Kubo DevDocs — Prueba de SMTP',
        text: 'Conexión SMTP configurada correctamente.',
        html: '<p>Conexión SMTP configurada correctamente desde Kubo DevDocs.</p>',
      });
      return { ok: true, sentTo: userEmail };
    } catch (err) {
      const e = err as Error & { code?: string; response?: string };
      this.logger.error(
        `Test SMTP error: message="${e.message}" code=${e.code} response="${e.response}"`,
      );
      throw new BadGatewayException({
        code: 'EMAIL_SEND_ERROR',
        message: `No se pudo conectar al SMTP: ${e.message}${e.response ? ` · ${e.response}` : ''}`,
      });
    }
  }
}
