import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Put, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { OptionalIntPipe } from '../../common/pipes/optional-int.pipe';
import { WorkspaceService } from '../workspace/workspace.service';
import { LatencyAlertSettingsDto } from './dto/latency.dto';
import { MonitorLatencyHour } from './entities/monitor-latency-hour.entity';
import { MonitorService } from './entities/monitor-service.entity';

const DAY_MS = 24 * 60 * 60_000;

/** Alerta de latencia por hora: destinatarios y datos del gráfico (spec 2026-11-28-alerta-latencia). */
@Controller('availability')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class AvailabilityLatencyController {
  constructor(
    private readonly workspace: WorkspaceService,
    @InjectRepository(MonitorLatencyHour) private readonly hours: Repository<MonitorLatencyHour>,
    @InjectRepository(MonitorService) private readonly services: Repository<MonitorService>,
  ) {}

  @Get('latency-alert-settings')
  async getSettings(): Promise<{ emails: string[] }> {
    return { emails: await this.workspace.getLatencyAlertEmails() };
  }

  @Put('latency-alert-settings')
  @Roles('ADMIN')
  async putSettings(@Body() dto: LatencyAlertSettingsDto): Promise<{ emails: string[] }> {
    // La columna guarda la lista unida (VARCHAR(1000)); mejor 400 aquí que 500 en MySQL.
    if (dto.emails.map((e) => e.trim()).join(', ').length > 1000) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'La lista de destinatarios es demasiado larga (máximo 1000 caracteres).' });
    }
    return { emails: await this.workspace.setLatencyAlertEmails(dto.emails) };
  }

  /** Horas del ping (ICMP) del servidor en los últimos `days` días (1–90, por defecto 7). */
  @Get('servers/:id/latency')
  async serverLatency(@Param('id', ParseIntPipe) id: number, @Query('days', OptionalIntPipe) days?: number) {
    const ping = (await this.services.find({ where: { serverId: id, protocol: 'ICMP' }, order: { id: 'ASC' } }))[0];
    if (!ping) return { service: null, hours: [] };
    const span = Math.min(90, Math.max(1, days ?? 7));
    const now = Date.now();
    const rows = await this.hours.find({
      where: { serviceId: Number(ping.id), hourStart: Between(new Date(now - span * DAY_MS), new Date(now)) },
      order: { hourStart: 'ASC' },
    });
    return {
      service: { id: Number(ping.id), name: ping.name, target: ping.target, latencyThresholdMs: Number(ping.latencyThresholdMs) },
      hours: rows.map((h) => ({
        hourStart: h.hourStart, total: h.total, slow: h.slow, avgMs: h.avgMs, p95Ms: h.p95Ms, maxMs: h.maxMs, isSlow: Boolean(h.isSlow),
      })),
    };
  }
}
