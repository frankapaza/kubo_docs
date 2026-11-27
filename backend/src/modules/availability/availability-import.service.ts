import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, In, Repository } from 'typeorm';
import { ClientsService } from '../clients/clients.service';
import { ClientSystemsRepository } from '../tickets/client-systems.repository';
import { normalizeKey, parseCsv } from './domain/csv-import';
import { serviceShapeError } from './domain/service-shape';
import { IMPORT_CSV_MAX_BYTES } from './dto/import.dto';
import { CreateServerDto, CreateServiceDto } from './dto/inventory.dto';
import { MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';

export interface ImportRowData {
  clientId: number;
  server: { name: string; host: string; role: string | null; provider: string | null; region: string | null };
  service: {
    name: string;
    protocol: 'TCP' | 'HTTPS' | 'HTTP' | 'ICMP';
    target: string;
    port: number | null;
    latencyThresholdMs: number;
    criticality: 'HIGH' | 'MEDIUM' | 'LOW';
    systemId: number | null;
  };
}

export interface ImportRowResult {
  line: number;
  status: 'NEW' | 'DUPLICATE' | 'INVALID';
  errors: string[];
  serverAction: 'CREATE' | 'REUSE' | null;
  data: ImportRowData | null;
}

export interface ImportPreview {
  rows: ImportRowResult[];
  summary: { new: number; duplicate: number; invalid: number };
}

const REQUIRED = ['cliente', 'servidor', 'host', 'servicio', 'protocolo', 'destino'];
const CRITICALITY: Record<string, 'HIGH' | 'MEDIUM' | 'LOW'> = {
  ALTA: 'HIGH', MEDIA: 'MEDIUM', BAJA: 'LOW', HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW',
};
/** Propiedad del DTO -> columna del CSV, para los mensajes. */
const FIELD_COLUMN: Record<string, string> = {
  name: 'servidor', host: 'host', role: 'rol', provider: 'proveedor', region: 'region', target: 'destino',
};

const lc = (s: string) => s.trim().toLowerCase();
const serverKey = (clientId: number, name: string) => `${clientId}|${lc(name)}`;
const serviceKey = (sk: string, protocol: string, target: string, port: number | null) => `${sk}|${protocol}|${lc(target)}|${port ?? ''}`;

@Injectable()
export class AvailabilityImportService {
  constructor(
    @InjectRepository(MonitorServer) private readonly servers: Repository<MonitorServer>,
    @InjectRepository(MonitorService) private readonly services: Repository<MonitorService>,
    private readonly clients: ClientsService,
    private readonly clientSystems: ClientSystemsRepository,
    private readonly dataSource: DataSource,
  ) {}

  preview(csv: string): Promise<ImportPreview> {
    return this.evaluate(csv);
  }

  /** Vuelve a validar y crea todas las filas NEW en una sola transacción: si una falla, no se crea ninguna. */
  async commit(csv: string): Promise<{ createdServers: number; createdServices: number; skipped: number }> {
    const { rows } = await this.evaluate(csv);
    const fresh = rows.filter((r) => r.status === 'NEW');
    let createdServers = 0;
    let createdServices = 0;
    await this.dataSource.transaction(async (manager) => {
      const serverRepo = manager.getRepository(MonitorServer);
      const serviceRepo = manager.getRepository(MonitorService);
      const ids = new Map<string, number>();
      for (const r of fresh) {
        const d = r.data!;
        const sk = serverKey(d.clientId, d.server.name);
        let serverId = ids.get(sk);
        if (serverId === undefined) {
          if (r.serverAction === 'CREATE') {
            const saved = await serverRepo.save(serverRepo.create({ clientId: d.clientId, ...d.server }));
            serverId = Number(saved.id);
            createdServers++;
          } else {
            const found = (await serverRepo.find({ where: { clientId: d.clientId } })).find((s) => lc(s.name) === lc(d.server.name));
            if (!found) throw new BadRequestException({ code: 'BAD_INPUT', message: `Servidor "${d.server.name}" no encontrado` });
            serverId = Number(found.id);
          }
          ids.set(sk, serverId);
        }
        await serviceRepo.save(serviceRepo.create({ serverId, ...d.service }));
        createdServices++;
      }
    });
    return { createdServers, createdServices, skipped: rows.length - fresh.length };
  }

  private async evaluate(csv: string): Promise<ImportPreview> {
    if (Buffer.byteLength(csv, 'utf8') > IMPORT_CSV_MAX_BYTES) {
      throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'El CSV supera los 256 KB' });
    }
    const parsed = parseCsv(csv);
    const index = new Map<string, number>();
    parsed.header.forEach((h, i) => index.set(normalizeKey(h), i));
    const missing = REQUIRED.filter((c) => !index.has(c));
    if (!parsed.header.length || missing.length) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: `Faltan columnas obligatorias: ${missing.join(', ')}` });
    }

    const allClients = await this.clients.list({});
    const clientByName = new Map(allClients.map((c) => [lc(c.razonSocial), Number(c.id)]));
    const existingServers = new Map<string, string>(); // clave -> host
    const existingServices = new Set<string>();
    const systemsByClient = new Map<number, Map<string, number>>();

    const loadClient = async (clientId: number) => {
      if (systemsByClient.has(clientId)) return;
      const srvs = await this.servers.find({ where: { clientId } });
      const keyById = new Map<number, string>();
      for (const s of srvs) {
        const sk = serverKey(clientId, s.name);
        existingServers.set(sk, s.host);
        keyById.set(Number(s.id), sk);
      }
      if (srvs.length) {
        for (const sv of await this.services.find({ where: { serverId: In([...keyById.keys()]) } })) {
          const sk = keyById.get(Number(sv.serverId));
          if (sk) existingServices.add(serviceKey(sk, sv.protocol, sv.target, sv.port ?? null));
        }
      }
      const systems = await this.clientSystems.listByClient(clientId);
      systemsByClient.set(clientId, new Map(systems.map((s) => [lc(s.name), s.id])));
    };

    const fileServers = new Map<string, string>(); // clave -> host del primer alta en el archivo
    const fileServices = new Set<string>();
    const rows: ImportRowResult[] = [];

    for (const row of parsed.rows) {
      const cell = (col: string) => (index.has(col) ? (row.cells[index.get(col)!] ?? '').trim() : '');
      const errors: string[] = [];
      const fail = (m: string) => { if (!errors.includes(m)) errors.push(m); };

      for (const col of REQUIRED) if (!cell(col)) fail(`Falta el valor de «${col}»`);

      const clientName = cell('cliente');
      const clientId = clientName ? clientByName.get(lc(clientName)) : undefined;
      if (clientName && clientId === undefined) fail(`Cliente "${clientName}" no existe`);

      const protocol = cell('protocolo').toUpperCase();
      const portRaw = cell('puerto');
      let port: number | null = null;
      let portOk = true;
      if (portRaw) {
        port = /^\d+$/.test(portRaw) ? Number(portRaw) : NaN;
        if (!(port >= 1 && port <= 65535)) { fail('Puerto fuera de rango'); portOk = false; }
      }
      const latRaw = cell('umbral_ms');
      let latency: number | undefined;
      if (latRaw) {
        latency = /^\d+$/.test(latRaw) ? Number(latRaw) : NaN;
        if (!(latency >= 1 && latency <= 600000)) fail('Umbral fuera de rango (1 a 600000 ms)');
      }
      const critRaw = cell('criticidad');
      const criticality = critRaw ? CRITICALITY[critRaw.toUpperCase()] : undefined;
      if (critRaw && !criticality) fail('Criticidad inválida (ALTA, MEDIA o BAJA)');
      if (protocol && !['TCP', 'HTTPS', 'HTTP', 'ICMP'].includes(protocol)) fail('Protocolo inválido');
      else if (protocol && cell('destino')) {
        const shape = serviceShapeError(protocol, cell('destino'), portOk ? port : null);
        if (shape === 'HTTPS_URL') fail('HTTPS requiere una URL https://');
        if (shape === 'HTTP_URL') fail('HTTP requiere una URL http://');
        if (shape === 'ICMP_HOST') fail('ICMP (ping) requiere un host o una IP, no una URL');
        if (shape === 'TCP_PORT') fail('Puerto fuera de rango');
      }

      // Las mismas reglas de forma que el alta manual: los DTO de inventario.
      const serverDto = plainToInstance(CreateServerDto, {
        clientId: clientId ?? 1, name: cell('servidor'), host: cell('host'),
        role: cell('rol') || undefined, provider: cell('proveedor') || undefined, region: cell('region') || undefined,
      });
      const serviceDto = plainToInstance(CreateServiceDto, { serverId: 1, name: cell('servicio'), protocol: protocol || 'TCP', target: cell('destino') });
      for (const e of [...(await validate(serverDto)), ...(await validate(serviceDto))]) {
        const col = e.property === 'name' && e.target instanceof CreateServiceDto ? 'servicio' : FIELD_COLUMN[e.property];
        if (col && cell(col)) fail(`Valor inválido en «${col}» (demasiado largo)`);
      }

      let systemId: number | null = null;
      if (clientId !== undefined) {
        await loadClient(clientId);
        const sysName = cell('sistema');
        if (sysName) {
          const sid = systemsByClient.get(clientId)?.get(lc(sysName));
          if (sid === undefined) fail(`Sistema "${sysName}" no pertenece al cliente`);
          else systemId = sid;
        }
      }

      let serverAction: 'CREATE' | 'REUSE' = 'CREATE';
      if (clientId !== undefined && cell('servidor') && cell('host')) {
        const known = existingServers.get(serverKey(clientId, cell('servidor'))) ?? fileServers.get(serverKey(clientId, cell('servidor')));
        if (known !== undefined) {
          if (lc(known) !== lc(cell('host'))) fail(`El servidor "${cell('servidor')}" ya existe con otro host (${known})`);
          else serverAction = 'REUSE';
        }
      }

      if (errors.length || clientId === undefined) {
        rows.push({ line: row.line, status: 'INVALID', errors, serverAction: null, data: null });
        continue;
      }

      const sk = serverKey(clientId, cell('servidor'));
      const key = serviceKey(sk, protocol, cell('destino'), port);
      const data: ImportRowData = {
        clientId,
        server: { name: cell('servidor'), host: cell('host'), role: cell('rol') || null, provider: cell('proveedor') || null, region: cell('region') || null },
        service: {
          name: cell('servicio'), protocol: protocol as 'TCP' | 'HTTPS' | 'HTTP' | 'ICMP', target: cell('destino'), port,
          latencyThresholdMs: latency ?? 1500, criticality: criticality ?? 'MEDIUM', systemId,
        },
      };
      if (existingServices.has(key) || fileServices.has(key)) {
        rows.push({ line: row.line, status: 'DUPLICATE', errors: [], serverAction: 'REUSE', data });
        continue;
      }
      fileServices.add(key);
      if (serverAction === 'CREATE') fileServers.set(sk, cell('host'));
      rows.push({ line: row.line, status: 'NEW', errors: [], serverAction, data });
    }

    const count = (s: ImportRowResult['status']) => rows.filter((r) => r.status === s).length;
    return { rows, summary: { new: count('NEW'), duplicate: count('DUPLICATE'), invalid: count('INVALID') } };
  }
}
