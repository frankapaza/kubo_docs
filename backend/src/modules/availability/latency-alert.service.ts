import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Repository } from 'typeorm';

import { PERU_TIME_ZONE } from '../../common/time-zone';
import { emailButton, emailCallout, escapeEmailHtml } from '../email/email-layout';
import { EmailService } from '../email/email.service';
import { UsersRepository } from '../users/users.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { HourStats, episodeStep, hasEnoughData, isOfficeWide, isSlowHour, summarizeHour } from './domain/latency-hour';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorLatencyEpisode } from './entities/monitor-latency-episode.entity';
import { MonitorLatencyHour } from './entities/monitor-latency-hour.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';

const HOUR_MS = 60 * 60_000;
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

export function previousHourStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - HOUR_MS);
}

const limaHour = (d: Date) =>
  new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: PERU_TIME_ZONE }).format(d);

const pct = (s: { total: number; slow: number }) => (s.total ? Math.round((s.slow / s.total) * 100) : 0);

/**
 * Alerta de latencia por hora (spec 2026-11-28-alerta-latencia). A los :05 resume
 * la hora anterior de cada ping (ICMP) medido desde la oficina, guarda la
 * estadística y abre o cierra el episodio de lentitud. Avisa por correo solo al
 * abrir y al cerrar. Idempotente por (servicio, hora).
 */
@Injectable()
export class LatencyAlertService {
  private readonly logger = new Logger(LatencyAlertService.name);
  private running = false;

  constructor(
    @InjectRepository(MonitorService) private readonly services: Repository<MonitorService>,
    @InjectRepository(MonitorServer) private readonly servers: Repository<MonitorServer>,
    @InjectRepository(MonitorProbe) private readonly probes: Repository<MonitorProbe>,
    @InjectRepository(MonitorCheck) private readonly checks: Repository<MonitorCheck>,
    @InjectRepository(MonitorLatencyHour) private readonly hours: Repository<MonitorLatencyHour>,
    @InjectRepository(MonitorLatencyEpisode) private readonly episodes: Repository<MonitorLatencyEpisode>,
    private readonly users: UsersRepository,
    private readonly email: EmailService,
    private readonly workspace: WorkspaceService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 5 * * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.evaluateHour(previousHourStart(new Date()));
    } catch (e) {
      this.logger.error('No se pudo evaluar la latencia de la hora anterior', e as Error);
    } finally {
      this.running = false;
    }
  }

  async evaluateHour(hourStart: Date): Promise<void> {
    const officeIds = (await this.probes.find({ where: { kind: 'OFFICE' } })).map((p) => Number(p.id));
    if (officeIds.length === 0) return;
    const pings = await this.services.find({ where: { protocol: 'ICMP', status: 'ACTIVE' } });
    const activeIds = new Set(pings.map((s) => Number(s.id)));

    // Un ping pausado/archivado no debe dejar un episodio colgado ni mandar un «normalizado» falso.
    for (const ep of await this.episodes.find({ where: { endedHour: IsNull() } })) {
      if (activeIds.has(Number(ep.serviceId))) continue;
      ep.endedHour = hourStart;
      ep.closedReason = 'SERVICE_INACTIVE';
      await this.episodes.save(ep);
    }

    const end = new Date(hourStart.getTime() + HOUR_MS - 1);
    const results: Array<{ service: MonitorService; stats: HourStats; isNew: boolean }> = [];
    for (const service of pings) {
      const existing = await this.hours.findOne({ where: { serviceId: Number(service.id), hourStart } });
      if (existing) {
        results.push({ service, stats: existing, isNew: false });
        continue;
      }
      const rows = await this.checks.find({
        where: { serviceId: Number(service.id), probeId: In(officeIds), kind: 'REGULAR', startedAt: Between(hourStart, end) },
        select: { durationMs: true, ok: true },
      });
      const threshold = Number(service.latencyThresholdMs);
      const stats = summarizeHour(rows.map((r) => ({ durationMs: Number(r.durationMs), ok: Boolean(r.ok) })), threshold);
      await this.hours.save(
        this.hours.create({ serviceId: Number(service.id), hourStart, ...stats, thresholdMs: threshold, isSlow: isSlowHour(stats) }),
      );
      results.push({ service, stats, isNew: true });
    }

    const officeWide = isOfficeWide(results.filter((r) => hasEnoughData(r.stats)).map((r) => isSlowHour(r.stats)));
    const servers = new Map((await this.servers.find()).map((s) => [Number(s.id), s]));
    const to = await this.recipients();

    for (const r of results.filter((x) => x.isNew)) {
      const serviceId = Number(r.service.id);
      const open = await this.episodes.findOne({ where: { serviceId, endedHour: IsNull() } });
      const step = episodeStep(open !== null, r.stats);
      if (step === 'NONE') continue;
      const server = servers.get(Number(r.service.serverId));
      try {
        if (step === 'OPEN') {
          await this.episodes.save(this.episodes.create({ serviceId, startedHour: hourStart, officeWide }));
          if (to.length) await this.email.send({ to, ...this.startEmail(r.service, server, hourStart, r.stats, officeWide) });
        } else if (open) {
          open.endedHour = hourStart;
          open.closedReason = 'NORMAL';
          await this.episodes.save(open);
          const slowHours = (await this.hours.find({ where: { serviceId, hourStart: Between(open.startedHour, new Date(hourStart.getTime() - 1)) }, order: { hourStart: 'ASC' } }))
            .filter((h) => h.hourStart.getTime() >= open.startedHour.getTime() && h.hourStart.getTime() < hourStart.getTime());
          if (to.length) await this.email.send({ to, ...this.endEmail(r.service, server, open, hourStart, slowHours) });
        }
      } catch (e) {
        this.logger.error(`Alerta de latencia del servicio ${serviceId}: no se pudo registrar o avisar`, e as Error);
      }
    }
  }

  private async recipients(): Promise<string[]> {
    const configured = await this.workspace.getLatencyAlertEmails().catch(() => []);
    if (configured.length) return configured;
    return (await this.users.listActiveAdmins()).map((a) => a.email).filter(Boolean);
  }

  private link(server: MonitorServer | undefined): string {
    const base = ((this.config.get<string>('FRONTEND_URL') || '').trim() || DEFAULT_FRONTEND_URL).replace(/\/+$/, '');
    return server ? `${base}/monitoreo/servidores/${Number(server.id)}` : `${base}/monitoreo/estado`;
  }

  private who(service: MonitorService, server: MonitorServer | undefined): string {
    return `${server?.name ?? `Servidor ${service.serverId}`} (${service.target})`;
  }

  private officeNote(officeWide: boolean): string {
    return officeWide
      ? emailCallout(
          'Probablemente es el internet de la oficina',
          'En la misma hora todos los pings están lentos. Antes de reclamar al proveedor, revisa la conexión de la oficina.',
        )
      : '';
  }

  private table(rows: Array<{ hourStart: Date } & HourStats>): string {
    const td = 'padding:6px 10px;border-bottom:1px solid #e8edf3;font-size:13px';
    const head = ['Hora (Perú)', 'Pings', 'Lentos', '%', 'Promedio', 'p95', 'Máximo']
      .map((h) => `<th align="left" style="${td};color:#5b6b78;font-weight:600">${h}</th>`)
      .join('');
    const body = rows
      .map((r) => `<tr><td style="${td}">${limaHour(r.hourStart)}</td><td style="${td}">${r.total}</td><td style="${td}">${r.slow}</td><td style="${td}">${pct(r)} %</td><td style="${td}">${r.avgMs ?? '—'} ms</td><td style="${td}">${r.p95Ms ?? '—'} ms</td><td style="${td}">${r.maxMs ?? '—'} ms</td></tr>`)
      .join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 16px;border:1px solid #e3e8ef;border-radius:8px;background:#f7f9fc"><tr>${head}</tr>${body}</table>`;
  }

  private startEmail(service: MonitorService, server: MonitorServer | undefined, hourStart: Date, s: HourStats, officeWide: boolean) {
    const who = this.who(service, server);
    const umbral = Number(service.latencyThresholdMs);
    return {
      subject: `[KUBO Monitoreo] Ping lento: ${who}`,
      text: `Ping lento hacia ${who} desde la oficina.\nHora ${limaHour(hourStart)}: ${s.slow} de ${s.total} pings (${pct(s)} %) sobre ${umbral} ms. Promedio ${s.avgMs ?? '—'} ms, máximo ${s.maxMs ?? '—'} ms.${officeWide ? '\nTodos los pings están lentos a la vez: probablemente es el internet de la oficina.' : ''}\n${this.link(server)}`,
      html:
        `<p style="margin:0 0 12px">El ping desde la oficina hacia <strong>${escapeEmailHtml(who)}</strong> está lento.</p>` +
        `<p style="margin:0 0 6px">En la hora de las <strong>${limaHour(hourStart)}</strong>, <strong>${s.slow} de ${s.total}</strong> pings (${pct(s)} %) pasaron de ${umbral} ms.</p>` +
        this.table([{ hourStart, ...s }]) +
        this.officeNote(officeWide) +
        `<p style="margin:0 0 6px">Te avisaremos cuando se normalice, con el resumen hora por hora para el proveedor.</p>` +
        emailButton(this.link(server), 'Ver historial del servidor'),
    };
  }

  private endEmail(service: MonitorService, server: MonitorServer | undefined, ep: MonitorLatencyEpisode, endHour: Date, rows: MonitorLatencyHour[]) {
    const who = this.who(service, server);
    const horas = Math.max(1, Math.round((endHour.getTime() - ep.startedHour.getTime()) / HOUR_MS));
    const max = rows.reduce((m, r) => Math.max(m, Number(r.maxMs ?? 0)), 0);
    return {
      subject: `[KUBO Monitoreo] Ping normalizado: ${who}`,
      text: `El ping hacia ${who} volvió a la normalidad.\nLento de ${limaHour(ep.startedHour)} a ${limaHour(endHour)} (${horas} h). Máximo ${max} ms.\n${this.link(server)}`,
      html:
        `<p style="margin:0 0 12px">El ping desde la oficina hacia <strong>${escapeEmailHtml(who)}</strong> volvió a la normalidad.</p>` +
        `<p style="margin:0 0 6px">Estuvo lento de <strong>${limaHour(ep.startedHour)}</strong> a <strong>${limaHour(endHour)}</strong> (${horas} h). Máximo: <strong>${max} ms</strong>.</p>` +
        this.table(rows) +
        this.officeNote(ep.officeWide) +
        `<p style="margin:0 0 6px">Puedes reenviar esta tabla al proveedor como evidencia.</p>` +
        emailButton(this.link(server), 'Ver historial del servidor'),
    };
  }
}
