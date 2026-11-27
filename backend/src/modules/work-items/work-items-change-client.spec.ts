import { BadRequestException } from '@nestjs/common';

import { WorkItemsService } from './work-items.service';
import { WorkItem } from './entities/work-item.entity';
import { ClientUser } from '../portal/entities/client-user.entity';
import { Project } from '../projects/entities/project.entity';

const ITEM = {
  id: 5,
  code: 'RQ-0005',
  clientId: 1,
  clientSystemId: 11,
  projectId: 30,
  createdByClientUserId: 70,
  origin: 'PORTAL',
  status: 'SOLICITADO',
} as unknown as WorkItem;

const makeService = (opts: {
  users?: Record<number, { id: number; clientId: number; isActive: number }>;
  projects?: Record<number, { id: number; clientId: number }>;
  clientSystems?: Record<number, { id: number; clientId: number; isActive: number }>;
} = {}) => {
  let stored: WorkItem = { ...ITEM };
  const itemRepo = {
    update: jest.fn(async (_id: number, patch: Partial<WorkItem>) => {
      stored = { ...stored, ...patch } as WorkItem;
    }),
    findOneBy: jest.fn(async () => stored),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === WorkItem) return itemRepo;
      if (entity === ClientUser) return { findOneBy: async ({ id }: { id: number }) => opts.users?.[id] ?? null };
      if (entity === Project) return { findOneBy: async ({ id }: { id: number }) => opts.projects?.[id] ?? null };
      throw new Error('repo inesperado');
    }),
  };
  const repo = {
    findById: jest.fn(async () => stored),
    findClientSystem: jest.fn(async (id: number) => opts.clientSystems?.[id] ?? null),
    runInTransaction: jest.fn((work: (m: unknown) => Promise<unknown>) => work(manager)),
  };
  const events = { record: jest.fn().mockResolvedValue({}) };
  const names: Record<number, string> = { 1: 'Cobros Seguros', 2: 'Fidelity' };
  const clients = {
    findByIdOrFail: jest.fn(async (id: number) => {
      if (!names[id]) throw new Error('Cliente no encontrado');
      return { id, razonSocial: names[id] };
    }),
  };
  const service = new WorkItemsService(repo as any, events as any, clients as any);
  return { service, itemRepo, events, get stored() { return stored; } };
};

describe('WorkItemsService.changeClient', () => {
  it('pasa el requerimiento al cliente nuevo con su sistema y su usuario', async () => {
    const t = makeService({
      users: { 80: { id: 80, clientId: 2, isActive: 1 } },
      clientSystems: { 22: { id: 22, clientId: 2, isActive: 1 } },
      projects: { 30: { id: 30, clientId: 1 } },
    });
    const out = await t.service.changeClient(5, 9, { clientId: 2, clientSystemId: 22, clientUserId: 80 });
    expect(out).toMatchObject({ clientId: 2, clientSystemId: 22, createdByClientUserId: 80, projectId: null });
  });

  it('sin usuario ni sistema: no deja ninguno del cliente anterior', async () => {
    const t = makeService({ projects: { 30: { id: 30, clientId: 1 } } });
    const out = await t.service.changeClient(5, 9, { clientId: 2 });
    expect(out).toMatchObject({ clientId: 2, clientSystemId: null, createdByClientUserId: null });
  });

  it('conserva el proyecto si ya era del cliente nuevo', async () => {
    const t = makeService({ projects: { 30: { id: 30, clientId: 2 } } });
    const out = await t.service.changeClient(5, 9, { clientId: 2 });
    expect(out.projectId).toBe(30);
  });

  it('rechaza un usuario de otro cliente o inactivo', async () => {
    const t = makeService({ users: { 81: { id: 81, clientId: 1, isActive: 1 }, 82: { id: 82, clientId: 2, isActive: 0 } } });
    await expect(t.service.changeClient(5, 9, { clientId: 2, clientUserId: 81 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.service.changeClient(5, 9, { clientId: 2, clientUserId: 82 })).rejects.toBeInstanceOf(BadRequestException);
    expect(t.itemRepo.update).not.toHaveBeenCalled();
  });

  it('rechaza un sistema que no es del cliente nuevo', async () => {
    const t = makeService({ clientSystems: { 11: { id: 11, clientId: 1, isActive: 1 } } });
    await expect(t.service.changeClient(5, 9, { clientId: 2, clientSystemId: 11 })).rejects.toBeInstanceOf(BadRequestException);
    expect(t.itemRepo.update).not.toHaveBeenCalled();
  });

  it('rechaza pasarlo al mismo cliente', async () => {
    const t = makeService();
    await expect(t.service.changeClient(5, 9, { clientId: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deja constancia en el historial con ambos nombres', async () => {
    const t = makeService();
    await t.service.changeClient(5, 9, { clientId: 2 });
    expect(t.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 5,
        actorUserId: 9,
        reason: 'Cliente cambiado de «Cobros Seguros» a «Fidelity».',
        payload: { cambio: 'CLIENTE', deClienteId: 1, aClienteId: 2 },
      }),
    );
  });
});
