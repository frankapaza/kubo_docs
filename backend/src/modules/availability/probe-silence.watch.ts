import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { formatPeruDateTime } from '../../common/peru-date-time';
import { EmailService } from '../email/email.service';
import { UsersRepository } from '../users/users.repository';
import { silenceDecision } from './domain/probe-silence';
import { MonitorProbe } from './entities/monitor-probe.entity';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

/**
 * Cada minuto revisa las sondas: si una lleva 10 minutos sin reportar avisa por
 * correo a los administradores activos, y avisa otra vez cuando vuelve. La
 * columna `silence_alerted_at` se fija solo tras enviar (un fallo se reintenta
 * al minuto siguiente) y con una actualización condicional para no duplicar.
 */
@Injectable()
export class ProbeSilenceWatch {
  private readonly logger = new Logger(ProbeSilenceWatch.name);
  private running = false;

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
          {
            lastSeenAt: probe.lastSeenAt,
            silenceAlertedAt: probe.silenceAlertedAt,
            hasToken: probe.tokenHash != null,
            kind: probe.kind,
          },
          now,
        );
        if (decision === 'NONE') continue;
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
      this.logger.warn(`La sonda ${probe.code} requiere aviso pero no hay administradores activos`);
      return;
    }
    const alert = decision === 'ALERT';
    const last = probe.lastSeenAt ? formatPeruDateTime(probe.lastSeenAt) : 'sin registro';
    const link = `${(this.config.get<string>('FRONTEND_URL') || '').trim() || DEFAULT_FRONTEND_URL}/monitoreo/sondas`;
    const subject = alert
      ? `Monitoreo: la sonda ${probe.code} dejó de reportar`
      : `Monitoreo: la sonda ${probe.code} volvió a reportar`;
    const line = alert
      ? `La sonda ${probe.code} lleva más de 10 minutos sin reportar. Último contacto: ${last} (hora de Lima).`
      : `La sonda ${probe.code} volvió a reportar. Último contacto: ${last} (hora de Lima).`;
    await this.email.send({
      to,
      subject,
      text: `${line}\nSondas: ${link}`,
      html: `<p>${line}</p><p><a href="${link}">Ver sondas</a></p>`,
    });
    // Condicional: solo gana quien ve el valor que leyó; evita duplicar si dos pasadas se cruzan.
    await this.probes.update(
      { id: probe.id, silenceAlertedAt: alert ? IsNull() : (probe.silenceAlertedAt as Date) },
      { silenceAlertedAt: alert ? now : null },
    );
  }
}
