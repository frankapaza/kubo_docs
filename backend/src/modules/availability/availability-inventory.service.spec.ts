import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateServerDto } from './dto/inventory.dto';
import { createHash } from 'node:crypto';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AvailabilityInventoryController } from './availability-inventory.controller';
import { AvailabilityInventoryService } from './availability-inventory.service';

/** Dobles mínimos de repositorio: guardan en memoria lo que el servicio escribe. */
const makeService = () => {
  const servers: any[] = [{ id: 10, clientId: 1, name: 'srv', host: 'h', status: 'ACTIVE', agentTokenHash: 'f'.repeat(64) }];
  const services: any[] = [
    { id: 100, serverId: 10, status: 'ACTIVE' },
    { id: 101, serverId: 10, status: 'ACTIVE' },
  ];
  const probes: any[] = [
    { id: 1, code: 'oficina-01', kind: 'OFFICE', tokenHash: null, lastSeenAt: null, version: null, clockSkewMs: null },
    { id: 2, code: 'kubo-01', kind: 'DATACENTER', tokenHash: null, lastSeenAt: null, version: null, clockSkewMs: null },
  ];
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
  const config = { get: jest.fn((k: string): string | undefined => (k === 'FRONTEND_URL' ? 'https://docs.kubo.test/' : undefined)) };
  const svc = new AvailabilityInventoryService(
    repoOf(servers) as any,
    repoOf(services) as any,
    repoOf(probes) as any,
    clients as any,
    clientSystems as any,
    closer as any,
    config as any,
  );
  return { svc, probes, services, servers, closer, config };
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

  it('emitir token para una sonda que no es de oficina (kubo-01 corre en proceso) -> 400 y no guarda nada', async () => {
    const { svc, probes } = makeService();
    await expect(svc.issueProbeToken(2)).rejects.toMatchObject({ response: { code: 'BAD_INPUT' } });
    expect(probes[1].tokenHash).toBeNull();
  });

  it('las respuestas de servidores nunca llevan agentTokenHash (listar, crear, actualizar, cambiar estado)', async () => {
    const { svc } = makeService();
    const outs = [
      await svc.listServers(),
      await svc.createServer({ clientId: 1, name: 'n', host: 'h2' } as any),
      await svc.updateServer(10, { name: 'otro' }, 7),
      await svc.setServerStatus(10, 'ACTIVE', 7),
    ];
    for (const o of outs) {
      expect(JSON.stringify(o)).not.toContain('agentTokenHash');
      expect(JSON.stringify(o)).not.toContain('f'.repeat(64));
    }
    expect(outs[0]).toEqual([expect.objectContaining({ id: 10, name: 'srv' })]);
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

describe('AvailabilityInventoryService: token del agente', () => {
  it('emite kma_… una sola vez, guarda solo su sha256 y arma el script con FRONTEND_URL sin barra final', async () => {
    const { svc, servers } = makeService();
    servers[0].agentLastSeenAt = new Date('2026-01-01T00:00:00Z');
    servers[0].agentSilenceAlertedAt = new Date('2026-01-01T00:20:00Z');
    const { token, installScript } = await svc.issueAgentToken(10);
    expect(token).toMatch(/^kma_[A-Za-z0-9_-]{43}$/);
    expect(servers[0].agentTokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(servers[0].agentTokenCreatedAt).toBeInstanceOf(Date);
    // Token nuevo = instalación nueva: el silencio se cuenta desde la emisión.
    expect(servers[0].agentLastSeenAt).toBeNull();
    expect(servers[0].agentSilenceAlertedAt).toBeNull();
    expect(installScript).toContain("$central = 'https://docs.kubo.test'");
    expect(installScript).toContain(`$token = '${token}'`);
    expect(JSON.stringify(await svc.listServers())).not.toContain(token);
  });

  it('sin FRONTEND_URL usa el valor por defecto de desarrollo', async () => {
    const { svc, config } = makeService();
    config.get.mockReturnValue(undefined);
    const { installScript } = await svc.issueAgentToken(10);
    expect(installScript).toContain("$central = 'http://localhost:5173'");
  });

  it('revocar pone el hash en nulo y limpia el aviso de silencio', async () => {
    const { svc, servers } = makeService();
    await svc.issueAgentToken(10);
    servers[0].agentSilenceAlertedAt = new Date();
    await svc.revokeAgentToken(10);
    expect(servers[0].agentTokenHash).toBeNull();
    expect(servers[0].agentTokenCreatedAt).toBeNull();
    expect(servers[0].agentSilenceAlertedAt).toBeNull();
  });

  it('servidor inexistente -> 404', async () => {
    const { svc } = makeService();
    await expect(svc.issueAgentToken(99)).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
  });

  it('updateServer guarda agentWatchServices sin repetidos', async () => {
    const { svc, servers } = makeService();
    await svc.updateServer(10, { agentWatchServices: ['W3SVC', 'MSSQLSERVER', 'W3SVC'] }, 7);
    expect(servers[0].agentWatchServices).toEqual(['W3SVC', 'MSSQLSERVER']);
  });
});

describe('UpdateServerDto.agentWatchServices', () => {
  const check = async (v: unknown) => validate(plainToInstance(UpdateServerDto, { agentWatchServices: v }));
  it('acepta nombres de servicio válidos y null', async () => {
    expect(await check(['W3SVC', 'MSSQL_X', 'Servicio de prueba-1.2'])).toHaveLength(0);
    expect(await check(['MSSQL$SQLEXPRESS'])).toHaveLength(0);
    expect(await check(null)).toHaveLength(0);
  });
  it.each([
    ['más de 50', Array.from({ length: 51 }, (_, i) => `S${i}`)],
    ['vacío', ['']],
    ['más de 256', ['a'.repeat(257)]],
    ['caracteres raros', ['W3SVC; rm']],
    ['no es lista', 'W3SVC'],
  ])('rechaza %s', async (_n, v) => expect((await check(v)).length).toBeGreaterThan(0));
});

describe('AvailabilityInventoryController roles', () => {
  const proto = AvailabilityInventoryController.prototype as any;
  const roles = (h: string) => Reflect.getMetadata(ROLES_KEY, proto[h]);

  it.each(['createServer', 'updateServer', 'createService', 'testService', 'updateService', 'issueToken', 'revokeToken', 'issueAgentToken', 'revokeAgentToken'])(
    '%s exige ADMIN',
    (h) => expect(roles(h)).toEqual(['ADMIN']),
  );

  it.each(['listServers', 'listServices', 'listProbes', 'agentView'])('%s queda abierto al personal', (h) => expect(roles(h)).toBeUndefined());
});
