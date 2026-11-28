import { TicketsController } from './tickets.controller';

/**
 * El filtro de archivados del repositorio es tri-estado y solo la bandeja del
 * equipo lo pone. Esta es la puerta que lo decide: por omisión oculta los
 * archivados, y `archived=true` muestra solo esos.
 */
describe('TicketsController.list: archivados', () => {
  const make = () => {
    const service = { list: jest.fn().mockResolvedValue([]) };
    const controller = new TicketsController(
      service as any,
      {} as any,
      {} as any,
      {} as any,
      { notifyChanged: jest.fn() } as any,
      {} as any,
      { assertCanWork: jest.fn() } as any,
    );
    return { controller, service };
  };

  const listar = (controller: TicketsController, archived?: string) =>
    controller.list(
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, archived,
    );

  it('sin parámetro pide archived: false (la bandeja oculta los archivados)', async () => {
    const { controller, service } = make();
    await listar(controller);
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ archived: false }));
  });

  it('archived=any (al buscar) no filtra archivados: salen también', async () => {
    const { controller, service } = make();
    await listar(controller, 'any');
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ archived: undefined }));
  });

  it('archived=true pide solo los archivados', async () => {
    const { controller, service } = make();
    await listar(controller, 'true');
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ archived: true }));
  });
});


describe('TicketsController: sistema antes de trabajar', () => {
  const make = (guardFails = false) => {
    const order: string[] = [];
    const guard = {
      assertCanWork: jest.fn(async (_id: number, accion: string) => {
        order.push('guard:' + accion);
        if (guardFails) throw Object.assign(new Error('x'), { status: 409 });
      }),
    };
    const transitions = { transition: jest.fn(async () => (order.push('transition'), { id: 1 })) };
    const assignment = {
      take: jest.fn(async () => (order.push('take'), { id: 1 })),
      assign: jest.fn(async () => (order.push('assign'), { id: 1 })),
      escalate: jest.fn(async () => (order.push('escalate'), { id: 1 })),
    };
    const conclusion = { conclude: jest.fn(async () => (order.push('conclude'), { id: 1 })) };
    const controller = new TicketsController(
      {} as any, transitions as any, assignment as any, {} as any, { notifyChanged: jest.fn() } as any, conclusion as any, guard as any,
    );
    return { controller, guard, transitions, assignment, conclusion, order };
  };
  const user = { id: 3, email: 'a@k.pe', role: 'ADMIN' };

  it('tomar, asignar, escalar y concluir comprueban el sistema antes de actuar', async () => {
    const { controller, order } = make();
    await controller.take(user, 1);
    await controller.assign(user, 1, { assigneeUserId: 2 } as any);
    await controller.escalate(user, 1, { toLevel: 'N2' } as any);
    await controller.conclude(user, 1, { solucion: 'ok' } as any);
    expect(order).toEqual(['guard:tomarlo', 'take', 'guard:asignarlo', 'assign', 'guard:escalarlo', 'escalate', 'guard:concluirlo', 'conclude']);
  });

  it('mover a EN_ATENCION exige sistema; volver a TRIAJE o NUEVO no', async () => {
    const { controller, guard } = make();
    await controller.transition(user, 1, { toStatus: 'EN_ATENCION' } as any);
    expect(guard.assertCanWork).toHaveBeenCalledWith(1, 'cambiar su estado');
    guard.assertCanWork.mockClear();
    await controller.transition(user, 1, { toStatus: 'TRIAJE' } as any);
    await controller.transition(user, 1, { toStatus: 'NUEVO' } as any);
    expect(guard.assertCanWork).not.toHaveBeenCalled();
  });

  it('si falta el sistema, la acción no se ejecuta', async () => {
    const { controller, assignment } = make(true);
    await expect(controller.take(user, 1)).rejects.toMatchObject({ status: 409 });
    expect(assignment.take).not.toHaveBeenCalled();
  });
});

describe('TicketsController: tickets sin sistema', () => {
  const make = () => {
    const service = {
      list: jest.fn().mockResolvedValue([]),
      summaryWithoutSystem: jest.fn().mockResolvedValue([
        { clientId: 1, cliente: 'GrupoVyV', total: 8 },
        { clientId: 2, cliente: 'PROSOL', total: 1 },
      ]),
    };
    const controller = new TicketsController(service as any, {} as any, {} as any, {} as any, { notifyChanged: jest.fn() } as any, {} as any, {} as any);
    return { controller, service };
  };

  it('sinSistema=1 llega al repositorio como filtro; sin el parámetro, no', async () => {
    const { controller, service } = make();
    await controller.list(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, '1');
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ sinSistema: true }));
    await controller.list();
    expect(service.list).toHaveBeenLastCalledWith(expect.objectContaining({ sinSistema: false }));
  });

  it('el resumen suma el total de todos los clientes', async () => {
    const { controller } = make();
    await expect(controller.withoutSystemSummary()).resolves.toEqual({
      total: 9,
      porCliente: [
        { clientId: 1, cliente: 'GrupoVyV', total: 8 },
        { clientId: 2, cliente: 'PROSOL', total: 1 },
      ],
    });
  });
});
