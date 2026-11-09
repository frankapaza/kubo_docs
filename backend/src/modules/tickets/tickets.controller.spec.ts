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

  it('archived=true pide solo los archivados', async () => {
    const { controller, service } = make();
    await listar(controller, 'true');
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ archived: true }));
  });
});
