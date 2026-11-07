import { InstallationsService } from './installations.service';
import { fingerprintInstallationKey } from './domain/installation-key';

/**
 * Repositorio en memoria: lo bastante fiel (huella única, revocación) para
 * que "regenerar invalida la anterior" se pruebe de verdad y no contra un mock
 * que devuelve lo que se le diga.
 */
const makeService = () => {
  const rows: any[] = [];
  let seq = 0;
  const repo = {
    rows,
    findAll: jest.fn(async () => rows),
    findById: jest.fn(async (id: number) => rows.find((r) => r.id === id) ?? null),
    findByClientSystemId: jest.fn(async (id: number) => rows.find((r) => r.clientSystemId === id) ?? null),
    findByFingerprint: jest.fn(async (fp: string) => rows.find((r) => r.keyFingerprint === fp) ?? null),
    create: jest.fn(async (d: any) => {
      const row = { id: ++seq, keyRevokedAt: null, lastSeenAt: null, ...d };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async (id: number, patch: any) => {
      const row = rows.find((r) => r.id === id);
      Object.assign(row, patch);
      return row;
    }),
    listSources: jest.fn(async () => [] as any[]),
    upsertSource: jest.fn().mockResolvedValue(undefined),
    touchInstallation: jest.fn().mockResolvedValue(undefined),
  };
  const clientSystems = {
    findById: jest.fn().mockResolvedValue({ id: 50, clientId: 7, systemId: 3 }),
  };
  const systems = { findById: jest.fn().mockResolvedValue({ id: 3, name: 'ERP Core' }) };
  const clients = { findById: jest.fn().mockResolvedValue({ id: 7, razonSocial: 'ACME SAC' }) };
  const service = new InstallationsService(repo as any, clientSystems as any, systems as any, clients as any);
  return { service, repo, clientSystems, systems, clients };
};

describe('instalaciones de monitoreo', () => {
  it('CLIENTE exige una asignación que exista y tenga producto del catálogo', async () => {
    const { service, clientSystems, repo } = makeService();
    clientSystems.findById.mockResolvedValue(null);
    await expect(service.create({ kind: 'CLIENTE', clientSystemId: 50 } as any, 1)).rejects.toMatchObject({
      status: 404,
    });
    // La marcada por la 029 (system_id nulo) no tiene producto que monitorear.
    clientSystems.findById.mockResolvedValue({ id: 50, clientId: 7, systemId: null });
    await expect(service.create({ kind: 'CLIENTE', clientSystemId: 50 } as any, 1)).rejects.toMatchObject({
      status: 400,
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('una asignación solo tiene una instalación', async () => {
    const { service } = makeService();
    await service.create({ kind: 'CLIENTE', clientSystemId: 50 } as any, 1);
    await expect(service.create({ kind: 'CLIENTE', clientSystemId: 50 } as any, 1)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('INTERNA exige nombre', async () => {
    const { service } = makeService();
    await expect(service.create({ kind: 'INTERNA', name: '   ' } as any, 1)).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.create({ kind: 'INTERNA' } as any, 1)).rejects.toMatchObject({ status: 400 });
  });

  it('la clave se devuelve una vez y solo se guarda su huella', async () => {
    const { service, repo } = makeService();
    const issued = await service.create({ kind: 'INTERNA', name: 'Kubo Web' } as any, 9);
    expect(issued.secret).toMatch(/^klog_/);
    const saved = repo.rows[0];
    expect(saved.keyFingerprint).toBe(fingerprintInstallationKey(issued.secret));
    expect(saved.createdBy).toBe(9);
    // Ninguna columna guardada lleva la clave en claro...
    expect(JSON.stringify(saved)).not.toContain(issued.secret);
    // ...ni la vista que se lista después.
    expect(JSON.stringify(await service.list())).not.toContain(issued.secret);
    expect(issued.installation.keyPrefix).toBe(issued.secret.slice(0, 9));
    expect(issued.installation.keyStatus).toBe('ACTIVA');
  });

  it('minLevel por omisión es INFO', async () => {
    const { service, repo } = makeService();
    await service.create({ kind: 'INTERNA', name: 'X' } as any, 1);
    expect(repo.rows[0].minLevel).toBe('INFO');
  });

  it('regenerar invalida la anterior', async () => {
    const { service } = makeService();
    const first = await service.create({ kind: 'INTERNA', name: 'X' } as any, 1);
    const second = await service.regenerateKey(first.installation.id);
    expect(second.secret).not.toBe(first.secret);
    expect(await service.findActiveByFingerprint(fingerprintInstallationKey(first.secret))).toBeNull();
    expect(await service.findActiveByFingerprint(fingerprintInstallationKey(second.secret))).not.toBeNull();
  });

  it('regenerar una clave revocada la reactiva con la nueva', async () => {
    const { service } = makeService();
    const first = await service.create({ kind: 'INTERNA', name: 'X' } as any, 1);
    await service.revokeKey(first.installation.id);
    const second = await service.regenerateKey(first.installation.id);
    expect(second.installation.keyStatus).toBe('ACTIVA');
  });

  it('revocar hace que findActiveByFingerprint devuelva null', async () => {
    const { service } = makeService();
    const issued = await service.create({ kind: 'INTERNA', name: 'X' } as any, 1);
    const fp = fingerprintInstallationKey(issued.secret);
    expect(await service.findActiveByFingerprint(fp)).not.toBeNull();
    const view = await service.revokeKey(issued.installation.id);
    expect(view.keyStatus).toBe('REVOCADA');
    expect(await service.findActiveByFingerprint(fp)).toBeNull();
  });

  it('findActiveByFingerprint de una CLIENTE trae cliente y producto de la asignación', async () => {
    const { service } = makeService();
    const issued = await service.create({ kind: 'CLIENTE', clientSystemId: 50, minLevel: 'WARN' } as any, 1);
    const r = await service.findActiveByFingerprint(fingerprintInstallationKey(issued.secret));
    expect(r).toEqual({
      id: issued.installation.id,
      kind: 'CLIENTE',
      clientId: 7,
      systemId: 3,
      minLevel: 'WARN',
      displayName: 'ACME SAC · ERP Core',
    });
  });

  it('una CLIENTE cuya asignación se borró no resuelve', async () => {
    const { service, clientSystems } = makeService();
    const issued = await service.create({ kind: 'CLIENTE', clientSystemId: 50 } as any, 1);
    clientSystems.findById.mockResolvedValue(null);
    expect(await service.findActiveByFingerprint(fingerprintInstallationKey(issued.secret))).toBeNull();
  });

  it('una INTERNA resuelve sin cliente y con el producto opcional', async () => {
    const { service } = makeService();
    const issued = await service.create({ kind: 'INTERNA', name: 'Kubo Web', systemId: 3 } as any, 1);
    const r = await service.findActiveByFingerprint(fingerprintInstallationKey(issued.secret));
    expect(r).toMatchObject({ kind: 'INTERNA', clientId: null, systemId: 3, displayName: 'Kubo Web' });
  });

  it('update cambia el nivel mínimo y el nombre de una INTERNA', async () => {
    const { service } = makeService();
    const issued = await service.create({ kind: 'INTERNA', name: 'X' } as any, 1);
    const view = await service.update(issued.installation.id, { minLevel: 'ERROR', name: ' Y ' });
    expect(view.minLevel).toBe('ERROR');
    expect(view.displayName).toBe('Y');
  });

  it('una instalación inexistente da 404', async () => {
    const { service } = makeService();
    await expect(service.regenerateKey(99)).rejects.toMatchObject({ status: 404 });
    await expect(service.revokeKey(99)).rejects.toMatchObject({ status: 404 });
    await expect(service.update(99, {})).rejects.toMatchObject({ status: 404 });
  });
});
