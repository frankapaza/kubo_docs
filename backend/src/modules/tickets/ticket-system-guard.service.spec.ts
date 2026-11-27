import { TicketSystemGuard } from './ticket-system-guard.service';

function make(ticket: Record<string, unknown> | null, systems: unknown[] = [{ id: 17 }]) {
  const repo = { findById: jest.fn(async () => ticket) };
  const sys = { listActiveByClient: jest.fn(async () => systems) };
  return { guard: new TicketSystemGuard(repo as any, sys as any), repo, sys };
}
const requerido = { response: expect.objectContaining({ code: 'SISTEMA_REQUERIDO' }) };

describe('TicketSystemGuard.assertCanWork', () => {
  it('sin sistema y cliente con sistemas -> 409 SISTEMA_REQUERIDO con la acción en el mensaje', async () => {
    const { guard } = make({ id: 1, clientId: 1, systemId: null, origin: 'EMAIL' });
    await expect(guard.assertCanWork(1, 'tomarlo')).rejects.toMatchObject({ status: 409, ...requerido });
    await expect(guard.assertCanWork(1, 'tomarlo')).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'Asigna el sistema del ticket antes de tomarlo.' }),
    });
  });

  it('con sistema -> pasa sin consultar los sistemas del cliente', async () => {
    const { guard, sys } = make({ id: 1, clientId: 1, systemId: 17, origin: 'EMAIL' });
    await expect(guard.assertCanWork(1, 'tomarlo')).resolves.toBeUndefined();
    expect(sys.listActiveByClient).not.toHaveBeenCalled();
  });

  it('origen interno (MONITOREO) -> pasa aunque no tenga sistema', async () => {
    const { guard } = make({ id: 1, clientId: 1, systemId: null, origin: 'MONITOREO' });
    await expect(guard.assertCanWork(1, 'tomarlo')).resolves.toBeUndefined();
  });

  it('cliente sin sistemas activos -> pasa (no hay nada que elegir)', async () => {
    const { guard } = make({ id: 1, clientId: 1, systemId: null, origin: 'NOTE' }, []);
    await expect(guard.assertCanWork(1, 'tomarlo')).resolves.toBeUndefined();
  });

  it('ticket sin cliente -> pasa; ticket inexistente -> lo resuelve el servicio (pasa aquí)', async () => {
    await expect(make({ id: 1, clientId: null, systemId: null, origin: 'NOTE' }).guard.assertCanWork(1, 'x')).resolves.toBeUndefined();
    await expect(make(null).guard.assertCanWork(1, 'x')).resolves.toBeUndefined();
  });
});
