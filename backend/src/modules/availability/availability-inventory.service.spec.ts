import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AvailabilityInventoryController } from './availability-inventory.controller';
import { AvailabilityInventoryService } from './availability-inventory.service';

/** Dobles mínimos de repositorio: guardan en memoria lo que el servicio escribe. */
const makeService = () => {
  const servers: any[] = [{ id: 10, clientId: 1, name: 'srv', host: 'h', status: 'ACTIVE' }];
  const services: any[] = [
    { id: 100, serverId: 10, status: 'ACTIVE' },
    { id: 101, serverId: 10, status: 'ACTIVE' },
  ];
  const probes: any[] = [{ id: 1, code: 'oficina-01', kind: 'OFFICE', tokenHash: null, lastSeenAt: null, version: null, clockSkewMs: null }];
  const repoOf = (rows: any[]) => ({
    find: jest.fn(async (opts?: any) => rows.filter((r) => !opts?.where || Object.entries(opts.where).every(([k, v]) => r[k] === v))),
    findOne: jest.fn(async (opts: any) => rows.find((r) => Object.entries(opts.where).every(([k, v]) => r[k] === v)) ?? null),
    create: jest.fn((d: any) => ({ ...d })),
    save: jest.fn(async (e: any) => {
      if (!e.id) {
        e.id = rows.length + 200;
        rows.push(e);
      }
      return e;
    }),
  });
  const clients = { findByIdOrFail: jest.fn(async () => ({ id: 1 })) };
  const clientSystems = { findById: jest.fn(async (id: number) => (id === 5 ? { id: 5, clientId: 1 } : id === 6 ? { id: 6, clientId: 2 } : null)) };
  const closer = { closeForPause: jest.fn(async () => undefined) };
  const svc = new AvailabilityInventoryService(
    repoOf(servers) as any,
    repoOf(services) as any,
    repoOf(probes) as any,
    clients as any,
    clientSystems as any,
    closer as any,
  );
  return { svc, probes, services, closer };
};

const base = { serverId: 10, name: 'web', protocol: 'HTTPS' as const, target: 'https://x.test' };

describe('AvailabilityInventoryService', () => {
  it('crear servicio HTTPS con target http:// -> BAD_INPUT', async () => {
    const { svc } = makeService();
    await expect(svc.createService({ ...base, target: 'http://x.test' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('crear servicio TCP sin puerto válido -> BAD_INPUT', async () => {
    const { svc } = makeService();
    await expect(svc.createService({ ...base, protocol: 'TCP', target: 'h', port: 70000 } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('crear servicio con systemId de otro cliente -> BAD_INPUT', async () => {
    const { svc } = makeService();
    await expect(svc.createService({ ...base, systemId: 6 } as any)).rejects.toMatchObject({ response: { code: 'BAD_INPUT' } });
  });

  it('crear servicio con systemId del cliente funciona', async () => {
    const { svc } = makeService();
    await expect(svc.createService({ ...base, systemId: 5 } as any)).resolves.toMatchObject({ systemId: 5 });
  });

  it('emitir token devuelve kmp_… y guarda solo su sha256; probes no lo trae', async () => {
    const { svc, probes } = makeService();
    const { token } = await svc.issueProbeToken(1);
    expect(token).toMatch(/^kmp_[A-Za-z0-9_-]{43}$/);
    expect(probes[0].tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    const list = await svc.listProbes();
    expect(list[0]).toMatchObject({ code: 'oficina-01', hasToken: true });
    expect(JSON.stringify(list)).not.toContain(token);
    expect(JSON.stringify(list)).not.toContain(probes[0].tokenHash);
  });

  it('revocar token deja hasToken en false', async () => {
    const { svc } = makeService();
    await svc.issueProbeToken(1);
    await svc.revokeProbeToken(1);
    expect((await svc.listProbes())[0].hasToken).toBe(false);
  });

  it('pausar un servicio con incidente abierto llama a closeForPause([id], actor)', async () => {
    const { svc, closer } = makeService();
    await svc.setServiceStatus(100, 'PAUSED', 7);
    expect(closer.closeForPause).toHaveBeenCalledWith([100], 7);
  });

  it('reactivar un servicio no cierra incidentes', async () => {
    const { svc, closer } = makeService();
    await svc.setServiceStatus(100, 'ACTIVE', 7);
    expect(closer.closeForPause).not.toHaveBeenCalled();
  });

  it('archivar un servidor llama a closeForPause con todos sus servicios', async () => {
    const { svc, closer } = makeService();
    await svc.setServerStatus(10, 'ARCHIVED', 7);
    expect(closer.closeForPause).toHaveBeenCalledWith([100, 101], 7);
  });

  it('si closeForPause falla, el estado ya quedó guardado y el error se propaga', async () => {
    const { svc, closer, services } = makeService();
    closer.closeForPause.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.setServiceStatus(100, 'PAUSED', 7)).rejects.toThrow('boom');
    expect(services[0].status).toBe('PAUSED');
  });

  it('updateServer guarda campos y estado juntos antes de cerrar incidentes', async () => {
    const { svc, closer } = makeService();
    closer.closeForPause.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.updateServer(10, { name: 'nuevo', status: 'PAUSED' }, 7)).rejects.toThrow('boom');
    expect((await svc.listServers())[0]).toMatchObject({ name: 'nuevo', status: 'PAUSED' });
  });
});

describe('AvailabilityInventoryController roles', () => {
  const proto = AvailabilityInventoryController.prototype as any;
  const roles = (h: string) => Reflect.getMetadata(ROLES_KEY, proto[h]);

  it.each(['createServer', 'updateServer', 'createService', 'testService', 'updateService', 'issueToken', 'revokeToken'])(
    '%s exige ADMIN',
    (h) => expect(roles(h)).toEqual(['ADMIN']),
  );

  it.each(['listServers', 'listServices', 'listProbes'])('%s queda abierto al personal', (h) => expect(roles(h)).toBeUndefined());
});
