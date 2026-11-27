import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { MonitorMaintenance } from '../entities/monitor-maintenance.entity';
import { MaintenanceWindow } from './maintenance';

export const toMaintenanceWindow = (m: MonitorMaintenance): MaintenanceWindow => ({
  id: Number(m.id),
  serverId: m.serverId === null || m.serverId === undefined ? null : Number(m.serverId),
  serviceId: m.serviceId === null || m.serviceId === undefined ? null : Number(m.serviceId),
  startsAt: m.startsAt,
  endsAt: m.endsAt,
  reason: m.reason,
});

/** Ventanas activas en `now` (`starts_at <= now < ends_at`). Una sola consulta. */
export async function activeMaintenanceWindows(
  repo: Pick<Repository<MonitorMaintenance>, 'find'>,
  now: Date,
): Promise<MaintenanceWindow[]> {
  const rows = await repo.find({ where: { startsAt: LessThanOrEqual(now), endsAt: MoreThan(now) } });
  return rows.map(toMaintenanceWindow);
}
