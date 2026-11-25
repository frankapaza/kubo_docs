import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AvailabilityMaintenanceController } from './availability-maintenance.controller';
import { AvailabilityMaintenanceService } from './availability-maintenance.service';

const t = (v: any) => (v instanceof Date ? v.getTime() : v);

const matches = (row: any, where: any): boolean =>
  Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v instanceof FindOperator) {
      const x: any = v.value;
      switch (v.type) {
        case 'lessThan':
          return t(row[k]) < t(x);
        case 'lessThanOrEqual':
          return t(row[k]) <= t(x);
        case 'moreThan':
          return t(row[k]) > t(x);
        case 'in':
          return (x as any[]).map(Number).includes(Number(row[k]));
        default:
          throw new Error(`operador no soportado: ${v.type}`);
      }
    }
    return t(row[k]) === t(v);
  });

const repoOf = (rows: any[]) => {
  let nextId = 1;
  return {
    rows,
    find: jest.fn(async (opts: any = {}) => rows.filter((r) => matches(r, opts.where)).map((r) => ({ ...r }))),
    findOne: jest.fn(async (opts: any) => {
      const r = rows.find((x) => matches(x, opts.where));
      return r ? { ...r } : null;
    }),
    insert: jest.fn(async (d: any) => {
      const row = { id: nextId++, createdAt: new Date(), ...d };
      rows.push(row);
      return { identifiers: [{ id: row.id }] };
    }),
    update: jest.fn(async (where: any, patch: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, patch));
      return { affected: hit.length };
    }),
    delete: jest.fn(async (where: any) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { affected: before - rows.length };
    }),
  };
};

const NOW = new Date('2026-11-24T15:00:00.000Z');
const plus = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();

const make = () => {
  jest.useFakeTimers().setSystemTime(NOW);
  const maint = repoOf([]);
  const servers = repoOf([{ id: 10, clientId: 1, name: 'VMI2571371' }]);
  const services = repoOf([{ id: 100, serverId: 10, name: 'Web' }]);
  const svc = new AvailabilityMaintenanceService(maint as any, servers as any, services as any);
  return { svc, maint };
};

afterEach(() => jest.useRealTimers());

const expectCode = async (p: Promise<unknown>, type: any, code: string) => {
  const err: any = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(type);
  expect(err.getResponse()).toMatchObject({ code });
};

describe('AvailabilityMaintenanceService.create', () => {
  it('crea una ventana de servidor y la lista con su etiqueta', async () => {
    const { svc, maint } = make();
    const v = await svc.create({ serverId: 10, startsAt: plus(10), endsAt: plus(70), reason: '  Parche mensual  ' }, 7);
    expect(maint.rows[0]).toMatchObject({ serverId: 10, serviceId: null, reason: 'Parche mensual', createdBy: 7 });
    expect(v).toMatchObject({ id: 1, serverId: 10, serviceId: null, targetLabel: 'VMI2571371', status: 'SCHEDULED' });
  });

  it('ventana de servicio: etiqueta «servidor · servicio»', async () => {
    const { svc } = make();
    await svc.create({ serviceId: 100, startsAt: plus(-5), endsAt: plus(60), reason: 'Cambio de certificado' }, 7);
    const list = await svc.list({});
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ serviceId: 100, serverId: null, targetLabel: 'VMI2571371 · Web', status: 'ACTIVE' });
  });

  it('con las dos claves (o ninguna) da 400 BAD_INPUT', async () => {
    const { svc, maint } = make();
    await expectCode(svc.create({ serverId: 10, serviceId: 100, startsAt: plus(1), endsAt: plus(60), reason: 'abc' }, 7), BadRequestException, 'BAD_INPUT');
    await expectCode(svc.create({ startsAt: plus(1), endsAt: plus(60), reason: 'abc' }, 7), BadRequestException, 'BAD_INPUT');
    expect(maint.rows).toHaveLength(0);
  });

  it.each([
    ['fin antes del inicio', { startsAt: plus(60), endsAt: plus(10), reason: 'abc' }],
    ['fin igual al inicio', { startsAt: plus(60), endsAt: plus(60), reason: 'abc' }],
    ['ya terminada', { startsAt: plus(-120), endsAt: plus(-60), reason: 'abc' }],
    ['más de 7 días', { startsAt: plus(0), endsAt: plus(7 * 24 * 60 + 1), reason: 'abc' }],
    ['motivo corto', { startsAt: plus(0), endsAt: plus(60), reason: ' ab ' }],
    ['motivo largo', { startsAt: plus(0), endsAt: plus(60), reason: 'x'.repeat(256) }],
    ['fecha inválida', { startsAt: 'mañana', endsAt: plus(60), reason: 'abc' }],
  ])('%s -> 400 BAD_INPUT', async (_name, body) => {
    const { svc } = make();
    await expectCode(svc.create({ serverId: 10, ...body } as any, 7), BadRequestException, 'BAD_INPUT');
  });

  it('exactamente 7 días se acepta', async () => {
    const { svc } = make();
    await expect(svc.create({ serverId: 10, startsAt: plus(0), endsAt: plus(7 * 24 * 60), reason: 'abc' }, 7)).resolves.toBeDefined();
  });

  it('servidor o servicio inexistente -> 400 BAD_INPUT', async () => {
    const { svc } = make();
    await expectCode(svc.create({ serverId: 99, startsAt: plus(0), endsAt: plus(60), reason: 'abc' }, 7), BadRequestException, 'BAD_INPUT');
    await expectCode(svc.create({ serviceId: 999, startsAt: plus(0), endsAt: plus(60), reason: 'abc' }, 7), BadRequestException, 'BAD_INPUT');
  });
});

describe('AvailabilityMaintenanceService.remove / end / list', () => {
  it('borrar una ventana futura la elimina; una iniciada da 409 MAINTENANCE_STARTED', async () => {
    const { svc, maint } = make();
    await svc.create({ serverId: 10, startsAt: plus(10), endsAt: plus(60), reason: 'futura' }, 7);
    await svc.create({ serverId: 10, startsAt: plus(-10), endsAt: plus(60), reason: 'iniciada' }, 7);
    await svc.remove(1);
    expect(maint.rows.map((r) => r.id)).toEqual([2]);
    await expectCode(svc.remove(2), ConflictException, 'MAINTENANCE_STARTED');
    expect(maint.rows).toHaveLength(1);
    await expectCode(svc.remove(99), NotFoundException, 'NOT_FOUND');
  });

  it('terminar una activa pone ends_at = now; una no activa da 409 MAINTENANCE_NOT_ACTIVE', async () => {
    const { svc, maint } = make();
    await svc.create({ serverId: 10, startsAt: plus(-10), endsAt: plus(60), reason: 'activa' }, 7);
    await svc.create({ serverId: 10, startsAt: plus(10), endsAt: plus(60), reason: 'futura' }, 7);
    const v = await svc.end(1);
    expect(maint.rows[0].endsAt).toEqual(NOW);
    expect(v.status).toBe('ENDED');
    await expectCode(svc.end(1), ConflictException, 'MAINTENANCE_NOT_ACTIVE');
    await expectCode(svc.end(2), ConflictException, 'MAINTENANCE_NOT_ACTIVE');
    await expectCode(svc.end(99), NotFoundException, 'NOT_FOUND');
  });

  it('list filtra por superposición con [from, to) y ordena por inicio descendente', async () => {
    const { svc, maint } = make();
    maint.rows.push(
      { id: 1, serverId: 10, serviceId: null, startsAt: new Date(plus(-300)), endsAt: new Date(plus(-200)), reason: 'vieja', createdBy: 7, createdAt: NOW },
      { id: 2, serverId: 10, serviceId: null, startsAt: new Date(plus(-30)), endsAt: new Date(plus(30)), reason: 'actual', createdBy: 7, createdAt: NOW },
      { id: 3, serverId: null, serviceId: 100, startsAt: new Date(plus(60)), endsAt: new Date(plus(90)), reason: 'futura', createdBy: 7, createdAt: NOW },
    );
    expect((await svc.list({})).map((v) => v.id)).toEqual([3, 2, 1]);
    expect((await svc.list({ from: plus(-100), to: plus(60) })).map((v) => v.id)).toEqual([2]);
    await expectCode(svc.list({ from: 'ayer' }), BadRequestException, 'BAD_INPUT');
  });
});

describe('AvailabilityMaintenanceController', () => {
  it('lo que escribe exige ADMIN; la lista no', () => {
    const proto = AvailabilityMaintenanceController.prototype as any;
    expect(Reflect.getMetadata(ROLES_KEY, proto.create)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(ROLES_KEY, proto.end)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(ROLES_KEY, proto.remove)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(ROLES_KEY, proto.list)).toBeUndefined();
  });
});
