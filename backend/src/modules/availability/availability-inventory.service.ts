import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { ClientsService } from '../clients/clients.service';
import { ClientSystemsRepository } from '../tickets/client-systems.repository';
import { CheckResult, runCheck } from './core';
import { serviceShapeError } from './domain/service-shape';
import { buildInstallScript } from './domain/agent-install-script';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorEntityStatus, MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';
import { IncidentCloser } from './incident-closer';
import { CreateServerDto, CreateServiceDto, UpdateServerDto, UpdateServiceDto } from './dto/inventory.dto';

export const DEFAULT_PING_NAME = 'Ping (red)';
export const DEFAULT_PING_THRESHOLD_MS = 250;

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

/** Igual que `ProbeSilenceWatch`: lo que se usa si `FRONTEND_URL` no está configurada. */
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

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
    private readonly config: ConfigService,
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
    if (dto.addPing !== false) await this.addDefaultPing(saved);
    return toServerView(saved);
  }

  /**
   * «Ping (red)»: latencia de red pura hacia el servidor, para reclamar al
   * proveedor si sube (umbral 250 ms; la lentitud la mide la oficina). No se
   * duplica si otro servidor con la misma IP ya tiene uno activo (p. ej. dos
   * sistemas en el mismo VPS), y se omite si el host no sirve para ping.
   */
  private async addDefaultPing(server: MonitorServer): Promise<void> {
    const host = String(server.host ?? '').trim();
    if (!host || serviceShapeError('ICMP', host, null)) return;
    const existing = await this.services.find({ where: { protocol: 'ICMP', target: host } });
    if (existing.some((s) => s.status !== 'ARCHIVED')) return;
    await this.services.save(
      this.services.create({
        serverId: server.id,
        systemId: null,
        name: DEFAULT_PING_NAME,
        protocol: 'ICMP',
        target: host,
        port: null,
        latencyThresholdMs: DEFAULT_PING_THRESHOLD_MS,
        criticality: 'MEDIUM',
      }),
    );
  }

  async updateServer(id: number, dto: UpdateServerDto, actorUserId: number): Promise<ServerView> {
    const { status, ...fields } = dto;
    const server = await this.getServer(id);
    if (fields.agentWatchServices) fields.agentWatchServices = [...new Set(fields.agentWatchServices)];
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

  // ---- Agente de servidor ----

  /**
   * Emite el token del agente (`kma_…`, se devuelve una sola vez; solo se
   * guarda su sha256 hex) y el script de instalación con la URL de la central.
   * Un token nuevo es una instalación nueva: el silencio se cuenta desde la
   * emisión, no desde la última muestra del agente anterior.
   */
  async issueAgentToken(id: number): Promise<{ token: string; installScript: string }> {
    const server = await this.getServer(id);
    const token = `kma_${randomBytes(32).toString('base64url')}`;
    server.agentTokenHash = createHash('sha256').update(token).digest('hex');
    server.agentTokenCreatedAt = new Date();
    server.agentLastSeenAt = null;
    server.agentSilenceAlertedAt = null;
    await this.servers.save(server);
    return { token, installScript: buildInstallScript(this.centralUrl(), token) };
  }

  /** Sin token el servidor deja de dar `AGENT_SILENT` y el agente recibe 401. */
  async revokeAgentToken(id: number): Promise<void> {
    const server = await this.getServer(id);
    server.agentTokenHash = null;
    server.agentTokenCreatedAt = null;
    server.agentSilenceAlertedAt = null;
    await this.servers.save(server);
  }

  /** `FRONTEND_URL` sin barra final: la central a la que reporta el agente. */
  private centralUrl(): string {
    const url = (this.config.get<string>('FRONTEND_URL') || '').trim() || DEFAULT_FRONTEND_URL;
    return url.replace(/\/+$/, '');
  }

  // ---- Auxiliares ----

  private validateShape(protocol: string, target: string, port: number | null): void {
    const err = serviceShapeError(protocol, target, port);
    if (err === 'HTTPS_URL') throw badInput('Un servicio HTTPS exige un target que empiece por https://');
    if (err === 'HTTP_URL') throw badInput('Un servicio HTTP exige un target que empiece por http://');
    if (err === 'ICMP_HOST') throw badInput('Un servicio ICMP (ping) exige un host o una IP, no una URL');
    if (err === 'TCP_PORT') throw badInput('Un servicio TCP exige un puerto entre 1 y 65535');
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
