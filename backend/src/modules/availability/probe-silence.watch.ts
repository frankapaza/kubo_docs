import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { formatPeruDateTime } from '../../common/peru-date-time';
import { EmailService } from '../email/email.service';
import { escapeHtml } from '../notifications/domain/template-renderer';
import { UsersRepository } from '../users/users.repository';
import { silenceDecision } from './domain/probe-silence';
import { MonitorProbe } from './entities/monitor-probe.entity';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';
/** Tras arrancar, las sondas necesitan un momento para volver a reportar: no se alerta antes. */
export const STARTUP_GRACE_MS = 120_000;

/**
 * Cada minuto revisa las sondas: si una lleva 10 minutos sin reportar avisa por
 * correo a los administradores activos, y avisa otra vez cuando vuelve. La
 * columna `silence_alerted_at` se fija solo tras enviar (un fallo se reintenta
 * al minuto siguiente). Que el aviso no se duplique lo garantiza el indicador
 * `running` (una sola pasada a la vez, una sola instancia del backend); la
 * actualización condicional solo protege el valor que se escribe. Si no se
 * aplica (`affected` 0, la fila cambió), se registra y se recuerda en memoria lo
 * enviado para no repetir el correo cada minuto (ver `unwritten`).
 */
@Injectable()
export class ProbeSilenceWatch {
  private readonly logger = new Logger(ProbeSilenceWatch.name);
  private running = false;
  /** Instante de arranque; las alertas se posponen durante `STARTUP_GRACE_MS`. */
  startedAt = new Date();
  /** Sondas ya advertidas de «sin administradores» en este silencio. */
  private readonly warnedNoAdmins = new Set<number>();
  /**
   * Avisos enviados cuya marca no se pudo escribir (`affected` 0): se actúa como si se hubiera
   * escrito (`alertedAt`) mientras la base siga con el valor leído entonces (`dbValue`, ms o null),
   * para no reenviar el correo cada minuto. Si la base cambia, manda la base.
   */
  private readonly unwritten = new Map<number, { dbValue: number | null; alertedAt: Date | null }>();

  constructor(
    @InjectRepository(MonitorProbe) private readonly probes: Repository<MonitorProbe>,
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
      this.logger.error(`Vigilante de sondas fallido: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async check(now: Date): Promise<void> {
    const probes = await this.probes.find();
    for (const probe of probes) {
      try {
        const decision = silenceDecision(
          { lastSeenAt: probe.lastSeenAt, silenceAlertedAt: this.effectiveAlertedAt(probe) },
          now,
        );
        // La advertencia de «sin administradores» vale para todo el silencio, recuperación incluida.
        if (decision === 'NONE') {
          this.warnedNoAdmins.delete(probe.id);
          continue;
        }
        if (decision === 'ALERT' && now.getTime() - this.startedAt.getTime() < STARTUP_GRACE_MS) continue;
        await this.notify(probe, decision, now);
      } catch (e) {
        this.logger.error(`Aviso de la sonda ${probe.code} fallido: ${(e as Error).message}`);
      }
    }
  }

  private async notify(probe: MonitorProbe, decision: 'ALERT' | 'RECOVERED', now: Date): Promise<void> {
    const admins = await this.users.listActiveAdmins();
    const to = admins.map((a) => a.email).filter(Boolean);
    if (to.length === 0) {
      if (!this.warnedNoAdmins.has(probe.id)) {
        this.warnedNoAdmins.add(probe.id);
        this.logger.warn(`La sonda ${probe.code} requiere aviso pero no hay administradores activos`);
      }
      return;
    }
    const alert = decision === 'ALERT';
    const last = probe.lastSeenAt ? formatPeruDateTime(probe.lastSeenAt) : 'sin registro';
    const link = `${(this.config.get<string>('FRONTEND_URL') || '').trim() || DEFAULT_FRONTEND_URL}/monitoreo/sondas`;
    const subject = alert
      ? `Monitoreo: la sonda ${probe.code} dejó de reportar`
      : `Monitoreo: la sonda ${probe.code} volvió a reportar`;
    const line = (code: string) =>
      alert
        ? `La sonda ${code} lleva más de 10 minutos sin reportar. Último contacto: ${last} (hora de Lima).`
        : `La sonda ${code} volvió a reportar. Último contacto: ${last} (hora de Lima).`;
    await this.email.send({
      to,
      subject,
      text: `${line(probe.code)}\nSondas: ${link}`,
      html: `<p>${line(escapeHtml(probe.code))}</p><p><a href="${escapeHtml(link)}">Ver sondas</a></p>`,
    });
    // Condicional: solo escribe si la columna sigue como se leyó.
    const value = alert ? now : null;
    const res = await this.probes.update(
      { id: probe.id, silenceAlertedAt: probe.silenceAlertedAt === null ? IsNull() : probe.silenceAlertedAt },
      { silenceAlertedAt: value },
    );
    if (res.affected === 0) {
      // Correo ya enviado: sin esto, la misma decisión lo reenviaría cada minuto.
      this.unwritten.set(probe.id, { dbValue: probe.silenceAlertedAt?.getTime() ?? null, alertedAt: value });
      this.logger.warn(
        `La sonda ${probe.code}: aviso enviado pero la marca no se pudo guardar (la fila cambió); no se reenviará.`,
      );
    } else {
      this.unwritten.delete(probe.id);
    }
  }

  /** `silence_alerted_at` leído, o el que se envió y no se pudo escribir si la base no ha cambiado. */
  private effectiveAlertedAt(probe: MonitorProbe): Date | null {
    const u = this.unwritten.get(probe.id);
    if (!u) return probe.silenceAlertedAt;
    if ((probe.silenceAlertedAt?.getTime() ?? null) === u.dbValue) return u.alertedAt;
    this.unwritten.delete(probe.id);
    return probe.silenceAlertedAt;
  }
}
