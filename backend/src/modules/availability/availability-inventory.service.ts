import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { ClientsService } from '../clients/clients.service';
import { ClientSystemsRepository } from '../tickets/client-systems.repository';
import { CheckResult, runCheck } from './core';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorEntityStatus, MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';
import { IncidentCloser } from './incident-closer';
import { CreateServerDto, CreateServiceDto, UpdateServerDto, UpdateServiceDto } from './dto/inventory.dto';

export interface ProbeView {
  id: number;
  code: string;
  kind: 'OFFICE' | 'DATACENTER';
  lastSeenAt: Date | null;
  version: string | null;
  clockSkewMs: number | null;
  hasToken: boolean;
}

/** Servidor tal como sale por la API: sin la huella del token del agente. */
export type ServerView = Omit<MonitorServer, 'agentTokenHash'>;

const toServerView = (s: MonitorServer): ServerView => {
  const { agentTokenHash, ...view } = s;
  return view;
};

const badInput = (message: string) => new BadRequestException({ code: 'BAD_INPUT', message });
const notFound = (what: string) => new NotFoundException({ code: 'NOT_FOUND', message: `${what} no encontrado` });

@Injectable()
export class AvailabilityInventoryService {
  constructor(
    @InjectRepository(MonitorServer) private readonly servers: Repository<MonitorServer>,
    @InjectRepository(MonitorService) private readonly services: Repository<MonitorService>,
    @InjectRepository(MonitorProbe) private readonly probes: Repository<MonitorProbe>,
    private readonly clients: ClientsService,
    private readonly clientSystems: ClientSystemsRepository,
    private readonly closer: IncidentCloser,
  ) {}

  // ---- Servidores ----

  async listServers(): Promise<ServerView[]> {
    return (await this.servers.find({ order: { id: 'ASC' } })).map(toServerView);
  }

  async createServer(dto: CreateServerDto): Promise<ServerView> {
    await this.clients.findByIdOrFail(dto.clientId);
    const saved = await this.servers.save(
      this.servers.create({
        clientId: dto.clientId,
        name: dto.name,
        host: dto.host,
        role: dto.role ?? null,
        provider: dto.provider ?? null,
        region: dto.region ?? null,
      }),
    );
    return toServerView(saved);
  }

  async updateServer(id: number, dto: UpdateServerDto, actorUserId: number): Promise<ServerView> {
    const { status, ...fields } = dto;
    const server = await this.getServer(id);
    Object.assign(server, fields);
    return this.applyServerStatus(server, status, actorUserId);
  }

  /** Pausar o archivar cierra los incidentes abiertos de todos sus servicios. */
  async setServerStatus(id: number, status: MonitorEntityStatus, actorUserId: number): Promise<ServerView> {
    return this.applyServerStatus(await this.getServer(id), status, actorUserId);
  }

  /** Persiste campos y estado en un solo guardado y, después, cierra los incidentes. */
  private async applyServerStatus(server: MonitorServer, status: MonitorEntityStatus | undefined, actorUserId: number): Promise<ServerView> {
    if (status) server.status = status;
    const saved = await this.servers.save(server);
    if (status && status !== 'ACTIVE') {
      const ids = (await this.services.find({ where: { serverId: Number(server.id) } })).map((s) => Number(s.id));
      if (ids.length) await this.closer.closeForPause(ids, actorUserId);
    }
    return toServerView(saved);
  }

  // ---- Servicios ----

  listServices(serverId?: number): Promise<MonitorService[]> {
    return this.services.find({ where: serverId ? { serverId } : {}, order: { id: 'ASC' } });
  }

  async createService(dto: CreateServiceDto): Promise<MonitorService> {
    const server = await this.getServer(dto.serverId);
    this.validateShape(dto.protocol, dto.target, dto.port ?? null);
    await this.validateSystem(server.clientId, dto.systemId ?? null);
    return this.services.save(
      this.services.create({
        serverId: dto.serverId,
        systemId: dto.systemId ?? null,
        name: dto.name,
        protocol: dto.protocol,
        target: dto.target,
        port: dto.port ?? null,
        latencyThresholdMs: dto.latencyThresholdMs ?? 1500,
        criticality: dto.criticality ?? 'MEDIUM',
      }),
    );
  }

  async updateService(id: number, dto: UpdateServiceDto, actorUserId: number): Promise<MonitorService> {
    const { status, ...fields } = dto;
    const service = await this.getService(id);
    const next = { ...service, ...fields };
    this.validateShape(next.protocol, next.target, next.port ?? null);
    if (dto.systemId !== undefined) {
      const server = await this.getServer(service.serverId);
      await this.validateSystem(server.clientId, dto.systemId);
    }
    Object.assign(service, fields);
    return this.applyServiceStatus(service, status, actorUserId);
  }

  /** Pausar o archivar cierra sus incidentes abiertos (`SERVICE_PAUSED`, vía el evaluador). */
  async setServiceStatus(id: number, status: MonitorEntityStatus, actorUserId: number): Promise<MonitorService> {
    return this.applyServiceStatus(await this.getService(id), status, actorUserId);
  }

  /** Estado primero, cierre después: un fallo del cierre nunca deja incidentes cerrados con el estado sin cambiar. */
  private async applyServiceStatus(service: MonitorService, status: MonitorEntityStatus | undefined, actorUserId: number): Promise<MonitorService> {
    if (status) service.status = status;
    const saved = await this.services.save(service);
    if (status && status !== 'ACTIVE') await this.closer.closeForPause([Number(service.id)], actorUserId);
    return saved;
  }

  /** Ejecuta un chequeo único desde el backend; solo servicios del inventario. */
  async testService(serviceId: number): Promise<CheckResult> {
    const s = await this.getService(serviceId);
    const result = await runCheck(
      { id: Number(s.id), protocol: s.protocol, target: s.target, port: s.port, latencyThresholdMs: s.latencyThresholdMs },
      'MANUAL',
      new Date(),
    );
    s.lastManualCheckAt = new Date();
    await this.services.save(s);
    return result;
  }

  // ---- Sondas ----

  async listProbes(): Promise<ProbeView[]> {
    const rows = await this.probes.find({ order: { id: 'ASC' } });
    return rows.map((p) => ({
      id: Number(p.id),
      code: p.code,
      kind: p.kind,
      lastSeenAt: p.lastSeenAt,
      version: p.version,
      clockSkewMs: p.clockSkewMs,
      hasToken: p.tokenHash !== null,
    }));
  }

  /**
   * Devuelve el token en claro una única vez; solo se guarda su sha256 hex.
   * Solo para la sonda de la oficina: kubo-01 corre dentro del worker y no usa token.
   */
  async issueProbeToken(id: number): Promise<{ token: string }> {
    const probe = await this.getProbe(id);
    if (probe.kind !== 'OFFICE') throw badInput('Solo la sonda de la oficina usa token; kubo-01 corre dentro del worker');
    const token = `kmp_${randomBytes(32).toString('base64url')}`;
    probe.tokenHash = createHash('sha256').update(token).digest('hex');
    probe.tokenCreatedAt = new Date();
    await this.probes.save(probe);
    return { token };
  }

  async revokeProbeToken(id: number): Promise<void> {
    const probe = await this.getProbe(id);
    probe.tokenHash = null;
    probe.tokenCreatedAt = null;
    await this.probes.save(probe);
  }

  // ---- Auxiliares ----

  private validateShape(protocol: string, target: string, port: number | null): void {
    if (protocol === 'HTTPS' && !target.startsWith('https://')) throw badInput('Un servicio HTTPS exige un target que empiece por https://');
    if (protocol === 'TCP' && (port === null || !Number.isInteger(port) || port < 1 || port > 65535)) {
      throw badInput('Un servicio TCP exige un puerto entre 1 y 65535');
    }
  }

  private async validateSystem(clientId: number, systemId: number | null): Promise<void> {
    if (systemId === null) return;
    const cs = await this.clientSystems.findById(systemId);
    if (!cs || Number(cs.clientId) !== Number(clientId)) throw badInput('El sistema no pertenece al cliente del servidor');
  }

  private async getServer(id: number): Promise<MonitorServer> {
    const s = await this.servers.findOne({ where: { id } });
    if (!s) throw notFound('Servidor');
    return s;
  }

  private async getService(id: number): Promise<MonitorService> {
    const s = await this.services.findOne({ where: { id } });
    if (!s) throw notFound('Servicio');
    return s;
  }

  private async getProbe(id: number): Promise<MonitorProbe> {
    const p = await this.probes.findOne({ where: { id } });
    if (!p) throw notFound('Sonda');
    return p;
  }
}
