import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { AvailabilityImportService } from './availability-import.service';

const HEAD = 'cliente;servidor;host;rol;proveedor;region;servicio;protocolo;destino;puerto;criticidad;umbral_ms;sistema';

const make = (opts: { failOnServiceSave?: number } = {}) => {
  const servers: any[] = [{ id: 10, clientId: 1, name: 'SRV-WEB', host: '1.2.3.4' }];
  const services: any[] = [{ id: 100, serverId: 10, protocol: 'TCP', target: '1.2.3.4', port: 443 }];
  let saves = 0;
  const created: { servers: any[]; services: any[] } = { servers: [], services: [] };
  const repoOf = (rows: any[]) => ({
    find: jest.fn(async (o?: any) => rows.filter((r) => !o?.where || Object.entries(o.where).every(([k, v]: any) => (v?._value ? v._value.includes(r[k]) : r[k] === v)))),
    create: jest.fn((d: any) => ({ ...d })),
  });
  const clients = { list: jest.fn(async () => [{ id: 1, razonSocial: 'ACME SAC' }, { id: 2, razonSocial: 'Beta' }]) };
  const clientSystems = { listByClient: jest.fn(async (id: number) => (id === 1 ? [{ id: 5, name: 'ERP' }] : [])) };
  const manager = {
    getRepository: (entity: any) => {
      const isServer = entity.name === 'MonitorServer';
      const rows = isServer ? created.servers : created.services;
      return {
        find: async () => [...servers, ...created.servers],
        create: (d: any) => ({ ...d }),
        save: async (e: any) => {
          if (!isServer && ++saves === opts.failOnServiceSave) throw new Error('boom');
          e.id = 500 + rows.length;
          rows.push(e);
          return e;
        },
      };
    },
  };
  // Transacción simulada: si el callback lanza, se descarta lo escrito.
  const dataSource = {
    transaction: jest.fn(async (cb: any) => {
      try {
        await cb(manager);
      } catch (e) {
        created.servers.length = 0;
        created.services.length = 0;
        throw e;
      }
    }),
  };
  const svc = new AvailabilityImportService(repoOf(servers) as any, repoOf(services) as any, clients as any, clientSystems as any, dataSource as any);
  return { svc, created };
};

const csv = (...lines: string[]) => [HEAD, ...lines].join('\r\n');
const row = (o: Partial<Record<string, string>> = {}) =>
  [o.c ?? 'acme sac', o.s ?? 'SRV-NUEVO', o.h ?? '9.9.9.9', '', '', '', o.sv ?? 'Web', o.p ?? 'TCP', o.d ?? '9.9.9.9', o.port ?? '80', o.k ?? 'ALTA', '', o.sys ?? ''].join(';');

describe('AvailabilityImportService.preview', () => {
  it('fila nueva con servidor nuevo -> NEW/CREATE; criticidad ALTA -> HIGH', async () => {
    const { svc } = make();
    const r = await svc.preview(csv(row()));
    expect(r.summary).toEqual({ new: 1, duplicate: 0, invalid: 0 });
    expect(r.rows[0]).toMatchObject({ line: 2, status: 'NEW', serverAction: 'CREATE' });
    expect(r.rows[0].data?.service).toMatchObject({ criticality: 'HIGH', latencyThresholdMs: 1500, port: 80 });
  });

  it('fila repetida en el archivo -> DUPLICATE; el servidor se crea una sola vez', async () => {
    const { svc } = make();
    const r = await svc.preview(csv(row(), row({ sv: 'otro nombre' }), row({ d: '8.8.8.8' })));
    expect(r.rows.map((x) => x.status)).toEqual(['NEW', 'DUPLICATE', 'NEW']);
    expect(r.rows.map((x) => x.serverAction)).toEqual(['CREATE', 'REUSE', 'REUSE']);
  });

  it('servicio ya existente -> DUPLICATE', async () => {
    const { svc } = make();
    const r = await svc.preview(csv(row({ s: 'srv-web', h: '1.2.3.4', d: '1.2.3.4', port: '443' })));
    expect(r.rows[0]).toMatchObject({ status: 'DUPLICATE', serverAction: 'REUSE' });
  });

  it('cliente inexistente -> INVALID con el mensaje', async () => {
    const { svc } = make();
    const r = await svc.preview(csv(row({ c: 'Nadie' })));
    expect(r.rows[0]).toMatchObject({ status: 'INVALID', errors: ['Cliente "Nadie" no existe'] });
  });

  it('el mismo servidor con otro host -> INVALID', async () => {
    const { svc } = make();
    const r = await svc.preview(csv(row({ s: 'SRV-WEB', h: '5.5.5.5' })));
    expect(r.rows[0].errors).toEqual(['El servidor "SRV-WEB" ya existe con otro host (1.2.3.4)']);
  });

  it('protocolo, puerto, HTTPS y sistema inválidos', async () => {
    const { svc } = make();
    const r = await svc.preview(
      csv(row({ p: 'FTP' }), row({ port: '70000' }), row({ p: 'HTTPS', d: 'http://x', port: '' }), row({ sys: 'CRM' }), row({ p: 'TCP', port: '' })),
    );
    expect(r.rows.map((x) => x.errors)).toEqual([
      ['Protocolo inválido'],
      ['Puerto fuera de rango'],
      ['HTTPS requiere una URL https://'],
      ['Sistema "CRM" no pertenece al cliente'],
      ['Puerto fuera de rango'],
    ]);
    expect(r.summary.invalid).toBe(5);
  });

  it('sistema del cliente se resuelve; criticidad inglesa vale', async () => {
    const { svc } = make();
    const r = await svc.preview(csv(row({ sys: 'erp', k: 'low' })));
    expect(r.rows[0].data?.service).toMatchObject({ systemId: 5, criticality: 'LOW' });
  });

  it('falta una columna obligatoria -> 400; más de 256 KB -> 413', async () => {
    const { svc } = make();
    await expect(svc.preview('cliente;servidor\r\nA;B')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.preview('x'.repeat(256 * 1024 + 1))).rejects.toBeInstanceOf(PayloadTooLargeException);
  });
});

describe('AvailabilityImportService.commit', () => {
  it('crea servidores y servicios NEW y salta el resto', async () => {
    const { svc, created } = make();
    const r = await svc.commit(csv(row(), row({ d: '8.8.8.8' }), row({ c: 'Nadie' })));
    expect(r).toEqual({ createdServers: 1, createdServices: 2, skipped: 1 });
    expect(created.services.map((s) => s.serverId)).toEqual([500, 500]);
    expect(created.services[0]).toMatchObject({ criticality: 'HIGH', latencyThresholdMs: 1500 });
  });

  it('un error a mitad no deja nada creado', async () => {
    const { svc, created } = make({ failOnServiceSave: 2 });
    await expect(svc.commit(csv(row(), row({ d: '8.8.8.8' })))).rejects.toThrow('boom');
    expect(created.servers).toHaveLength(0);
    expect(created.services).toHaveLength(0);
  });
});
