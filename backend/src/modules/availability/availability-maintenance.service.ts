import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThan, Repository } from 'typeorm';
import { MonitorMaintenance } from './entities/monitor-maintenance.entity';
import { MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';

const badInput = (message: string) => new BadRequestException({ code: 'BAD_INPUT', message });
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Mantenimiento no encontrado' });

/** Duración máxima de una ventana. */
export const MAINTENANCE_MAX_MS = 7 * 24 * 60 * 60_000;
const REASON_MIN = 3;
const REASON_MAX = 255;

export type MaintenanceStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED';

export interface MaintenanceView {
  id: number;
  serverId: number | null;
  serviceId: number | null;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  createdBy: number | null;
  createdAt: Date;
  /** «VMI2571371» (servidor) o «VMI2571371 · Web» (servicio). */
  targetLabel: string;
  status: MaintenanceStatus;
}

export interface MaintenanceInput {
  serverId?: number | null;
  serviceId?: number | null;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export interface MaintenanceRange {
  from?: string;
  to?: string;
}

const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const given = (v: unknown): boolean => v !== null && v !== undefined;

function parseDate(value: string, field: string): Date {
  const d = typeof value === 'string' && value.trim() !== '' ? new Date(value) : new Date(NaN);
  if (Number.isNaN(d.getTime())) throw badInput(`Fecha inválida en ${field}`);
  return d;
}

/** Ventanas de mantenimiento: sin ticket ni aviso mientras están activas (decisión 5 de la Entrega 3). */
@Injectable()
export class AvailabilityMaintenanceService {
  constructor(
    @InjectRepository(MonitorMaintenance) private readonly maintenance: Repository<MonitorMaintenance>,
    @InjectRepository(MonitorServer) private readonly servers: Repository<MonitorServer>,
    @InjectRepository(MonitorService) private readonly services: Repository<MonitorService>,
  ) {}

  /** Las ventanas que se superponen con `[from, to)`; sin rango, todas. Las más recientes primero. */
  async list(range: MaintenanceRange): Promise<MaintenanceView[]> {
    const where: Record<string, unknown> = {};
    if (range.from !== undefined) where.endsAt = MoreThan(parseDate(range.from, 'from'));
    if (range.to !== undefined) where.startsAt = LessThan(parseDate(range.to, 'to'));
    const rows = await this.maintenance.find({ where, order: { startsAt: 'DESC', id: 'DESC' } });
    rows.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || Number(b.id) - Number(a.id));
    return this.toViews(rows, new Date());
  }

  async create(input: MaintenanceInput, userId: number): Promise<MaintenanceView> {
    const now = new Date();
    if (given(input.serverId) === given(input.serviceId)) throw badInput('Indica un servidor o un servicio (solo uno)');
    const startsAt = parseDate(input.startsAt, 'startsAt');
    const endsAt = parseDate(input.endsAt, 'endsAt');
    if (endsAt.getTime() <= startsAt.getTime()) throw badInput('El fin debe ser posterior al inicio');
    if (endsAt.getTime() <= now.getTime()) throw badInput('El fin debe ser posterior a la hora actual');
    if (endsAt.getTime() - startsAt.getTime() > MAINTENANCE_MAX_MS) throw badInput('La ventana no puede durar más de 7 días');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
      throw badInput(`El motivo debe tener entre ${REASON_MIN} y ${REASON_MAX} caracteres`);
    }

    const serverId = given(input.serverId) ? Number(input.serverId) : null;
    const serviceId = given(input.serviceId) ? Number(input.serviceId) : null;
    if (serverId !== null && !(await this.servers.findOne({ where: { id: serverId } }))) throw badInput('Servidor no encontrado');
    if (serviceId !== null && !(await this.services.findOne({ where: { id: serviceId } }))) throw badInput('Servicio no encontrado');

    const res = await this.maintenance.insert({ serverId, serviceId, startsAt, endsAt, reason, createdBy: userId });
    return this.view(Number(res.identifiers[0].id));
  }

  /** Termina ahora una ventana activa (`ends_at = now`). */
  async end(id: number): Promise<MaintenanceView> {
    const row = await this.maintenance.findOne({ where: { id } });
    if (!row) throw notFound();
    const now = new Date();
    const notActive = () =>
      new ConflictException({ code: 'MAINTENANCE_NOT_ACTIVE', message: 'La ventana de mantenimiento no está activa' });
    if (!(row.startsAt.getTime() <= now.getTime() && now.getTime() < row.endsAt.getTime())) throw notActive();
    // Compare-and-swap: si otra petición la terminó o la cambió entre medias, no se pisa.
    const res = await this.maintenance.update({ id, endsAt: row.endsAt }, { endsAt: now });
    if (res.affected === 0) throw notActive();
    return this.view(id);
  }

  /** Borra una ventana que aún no empezó; una iniciada solo se puede terminar. */
  async remove(id: number): Promise<void> {
    const row = await this.maintenance.findOne({ where: { id } });
    if (!row) throw notFound();
    const started = () =>
      new ConflictException({ code: 'MAINTENANCE_STARTED', message: 'La ventana ya empezó: termínala en lugar de borrarla' });
    const now = new Date();
    if (row.startsAt.getTime() <= now.getTime()) throw started();
    const res = await this.maintenance.delete({ id, startsAt: MoreThan(now) });
    if (res.affected === 0) throw started();
  }

  private async view(id: number): Promise<MaintenanceView> {
    const row = await this.maintenance.findOne({ where: { id } });
    if (!row) throw notFound();
    return (await this.toViews([row], new Date()))[0];
  }

  private async toViews(rows: MonitorMaintenance[], now: Date): Promise<MaintenanceView[]> {
    if (rows.length === 0) return [];
    const serviceIds = [...new Set(rows.map((r) => nOrNull(r.serviceId)).filter((v): v is number => v !== null))];
    const services = serviceIds.length ? await this.services.find({ where: { id: In(serviceIds) } }) : [];
    const serviceById = new Map(services.map((s) => [Number(s.id), s]));
    const serverIds = new Set(rows.map((r) => nOrNull(r.serverId)).filter((v): v is number => v !== null));
    for (const s of services) serverIds.add(Number(s.serverId));
    const servers = serverIds.size ? await this.servers.find({ where: { id: In([...serverIds]) } }) : [];
    const serverName = new Map(servers.map((s) => [Number(s.id), s.name]));

    return rows.map((r) => {
      const serviceId = nOrNull(r.serviceId);
      const serverId = nOrNull(r.serverId);
      let targetLabel: string;
      if (serviceId !== null) {
        const svc = serviceById.get(serviceId);
        targetLabel = svc ? `${serverName.get(Number(svc.serverId)) ?? ''} · ${svc.name}` : `Servicio ${serviceId}`;
      } else {
        targetLabel = serverName.get(serverId as number) ?? `Servidor ${serverId}`;
      }
      const t = now.getTime();
      const status: MaintenanceStatus = t < r.startsAt.getTime() ? 'SCHEDULED' : t < r.endsAt.getTime() ? 'ACTIVE' : 'ENDED';
      return {
        id: Number(r.id),
        serverId,
        serviceId,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        reason: r.reason,
        createdBy: nOrNull(r.createdBy),
        createdAt: r.createdAt,
        targetLabel,
        status,
      };
    });
  }
}
