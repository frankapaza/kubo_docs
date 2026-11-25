import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { formatPeruDateTime } from '../../common/peru-date-time';
import { EmailService } from '../email/email.service';
import { escapeHtml } from '../notifications/domain/template-renderer';
import { UsersRepository } from '../users/users.repository';
import { silenceDecision } from './domain/probe-silence';
import { MonitorServer } from './entities/monitor-server.entity';
import { STARTUP_GRACE_MS } from './probe-silence.watch';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

/**
 * Lo mismo que `ProbeSilenceWatch`, para el agente de cada servidor (decisión
 * 11): cada minuto, si un agente lleva 10 minutos sin muestras avisa por correo
 * a los administradores activos, y avisa otra vez cuando vuelve. Solo
 * servidores `ACTIVE` con token de agente. Un agente que nunca reportó no
 * alerta por correo (`silenceDecision`); el widget sí lo muestra mudo.
 *
 * Mismas protecciones: `agent_silence_alerted_at` se fija solo tras enviar, el
 * indicador `running` evita pasadas simultáneas, la actualización es
 * condicional y `unwritten` recuerda lo enviado si la marca no se pudo escribir.
 */
@Injectable()
export class AgentSilenceWatch {
  private readonly logger = new Logger(AgentSilenceWatch.name);
  private running = false;
  /** Instante de arranque; las alertas se posponen durante `STARTUP_GRACE_MS`. */
  startedAt = new Date();
  /** Servidores ya advertidos de «sin administradores» en este silencio. */
  private readonly warnedNoAdmins = new Set<number>();
  /** Avisos enviados cuya marca no se pudo escribir (ver `ProbeSilenceWatch.unwritten`). */
  private readonly unwritten = new Map<number, { dbValue: number | null; alertedAt: Date | null }>();

  constructor(
    @InjectRepository(MonitorServer) private readonly servers: Repository<MonitorServer>,
    private readonly users: UsersRepository,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 * * * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.check(new Date());
    } catch (e) {
      this.logger.error(`Vigilante de agentes fallido: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async check(now: Date): Promise<void> {
    const servers = await this.servers.find({ where: { status: 'ACTIVE', agentTokenHash: Not(IsNull()) } });
    for (const server of servers) {
      const id = Number(server.id);
      try {
        const decision = silenceDecision(
          { lastSeenAt: server.agentLastSeenAt, silenceAlertedAt: this.effectiveAlertedAt(server) },
          now,
        );
        if (decision === 'NONE') {
          this.warnedNoAdmins.delete(id);
          continue;
        }
        if (decision === 'ALERT' && now.getTime() - this.startedAt.getTime() < STARTUP_GRACE_MS) continue;
        await this.notify(server, decision, now);
      } catch (e) {
        this.logger.error(`Aviso del agente de ${server.name} fallido: ${(e as Error).message}`);
      }
    }
  }

  private async notify(server: MonitorServer, decision: 'ALERT' | 'RECOVERED', now: Date): Promise<void> {
    const id = Number(server.id);
    const admins = await this.users.listActiveAdmins();
    const to = admins.map((a) => a.email).filter(Boolean);
    if (to.length === 0) {
      if (!this.warnedNoAdmins.has(id)) {
        this.warnedNoAdmins.add(id);
        this.logger.warn(`El agente de ${server.name} requiere aviso pero no hay administradores activos`);
      }
      return;
    }
    const alert = decision === 'ALERT';
    const last = server.agentLastSeenAt ? formatPeruDateTime(server.agentLastSeenAt) : 'sin registro';
    const base = ((this.config.get<string>('FRONTEND_URL') || '').trim() || DEFAULT_FRONTEND_URL).replace(/\/+$/, '');
    const link = `${base}/monitoreo/servidores?serverId=${id}`;
    const subject = alert
      ? `[KUBO Monitoreo] El agente de ${server.name} no reporta`
      : `[KUBO Monitoreo] El agente de ${server.name} volvió a reportar`;
    const line = (name: string) =>
      alert
        ? `El agente del servidor ${name} lleva más de 10 minutos sin enviar datos. Último contacto: ${last}.`
        : `El agente del servidor ${name} volvió a reportar. Último contacto: ${last}.`;
    await this.email.send({
      to,
      subject,
      text: `${line(server.name)}\nServidores: ${link}`,
      html: `<p>${line(escapeHtml(server.name))}</p><p><a href="${escapeHtml(link)}">Ver servidores</a></p>`,
    });
    // Condicional: solo escribe si la columna sigue como se leyó.
    const value = alert ? now : null;
    const res = await this.servers.update(
      { id, agentSilenceAlertedAt: server.agentSilenceAlertedAt === null ? IsNull() : server.agentSilenceAlertedAt },
      { agentSilenceAlertedAt: value },
    );
    if (res.affected === 0) {
      this.unwritten.set(id, { dbValue: server.agentSilenceAlertedAt?.getTime() ?? null, alertedAt: value });
      this.logger.warn(`Agente de ${server.name}: aviso enviado pero la marca no se pudo guardar (la fila cambió); no se reenviará.`);
    } else {
      this.unwritten.delete(id);
    }
  }

  /** `agent_silence_alerted_at` leído, o el enviado sin escribir si la base no ha cambiado. */
  private effectiveAlertedAt(server: MonitorServer): Date | null {
    const id = Number(server.id);
    const u = this.unwritten.get(id);
    if (!u) return server.agentSilenceAlertedAt;
    if ((server.agentSilenceAlertedAt?.getTime() ?? null) === u.dbValue) return u.alertedAt;
    this.unwritten.delete(id);
    return server.agentSilenceAlertedAt;
  }
}
