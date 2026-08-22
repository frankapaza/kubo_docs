import { NotFoundException } from '@nestjs/common';

import { PortalReportsService } from './portal-reports.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { WorkItem } from '../work-items/entities/work-item.entity';

/**
 * Doble mínimo de cada repositorio: solo los tres métodos que `task-4` ya
 * probó por su cuenta. No filtran de verdad (a diferencia de los dobles de
 * `portal-requirements.service.spec.ts`) porque aquí lo que se vigila es
 * *qué* consulta el servicio y con qué argumentos, no cómo filtra el
 * repositorio — eso ya lo cubre su propia suite.
 */
function make(opts: { ahora?: Date; ticketRows?: Partial<Ticket>[]; requirementRows?: Partial<WorkItem>[] }) {
  jest.useFakeTimers().setSystemTime(opts.ahora ?? new Date('2026-12-01T00:00:00Z'));

  const ticketsRepo = {
    listForClientPeriod: jest.fn().mockResolvedValue(opts.ticketRows ?? []),
    countResolvedInPeriod: jest.fn().mockResolvedValue(0),
  };
  const workItemsRepo = {
    listPortalRequirementsInPeriod: jest.fn().mockResolvedValue(opts.requirementRows ?? []),
  };
  const clients = {
    findByIdOrFail: jest.fn().mockResolvedValue({ razonSocial: 'Cliente de Prueba S.A.C.' }),
  };

  const service = new PortalReportsService(ticketsRepo as any, workItemsRepo as any, clients as any);

  return { service, ticketsRepo, workItemsRepo, clients };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('PortalReportsService.monthly', () => {
  it('rechaza el mes en curso', async () => {
    const { service } = make({ ahora: new Date('2026-08-07T12:00:00Z') });
    await expect(service.monthly(7, { year: 2026, month: 8, scope: 'AMBOS' }))
      .rejects.toThrow(/ya termin/i);
  });

  it('rechaza una sesion sin empresa utilizable', async () => {
    const { service } = make({});
    await expect(service.monthly(0, { year: 2026, month: 7, scope: 'AMBOS' }))
      .rejects.toThrow(/no identifica a ninguna empresa/i);
  });

  // Que el bloque no pedido no se consulte no es una optimizacion: es que el
  // informe no debe leer datos que nadie pidio.
  it('no consulta los requerimientos si el alcance es TICKETS', async () => {
    const { service, ticketsRepo, workItemsRepo } = make({});
    await service.monthly(7, { year: 2026, month: 7, scope: 'TICKETS' });
    expect(ticketsRepo.listForClientPeriod).toHaveBeenCalled();
    expect(workItemsRepo.listPortalRequirementsInPeriod).not.toHaveBeenCalled();
  });

  it('no consulta los tickets si el alcance es REQUERIMIENTOS', async () => {
    const { service, ticketsRepo, workItemsRepo } = make({});
    await service.monthly(7, { year: 2026, month: 7, scope: 'REQUERIMIENTOS' });
    expect(ticketsRepo.listForClientPeriod).not.toHaveBeenCalled();
    expect(ticketsRepo.countResolvedInPeriod).not.toHaveBeenCalled();
    expect(workItemsRepo.listPortalRequirementsInPeriod).toHaveBeenCalled();
  });

  it('pasa a las consultas el clientId de la sesion y las fronteras en hora de Peru', async () => {
    const { service, ticketsRepo } = make({});
    await service.monthly(7, { year: 2026, month: 7, scope: 'TICKETS' });
    const [clientId, from, to] = ticketsRepo.listForClientPeriod.mock.calls[0];
    expect(clientId).toBe(7);
    expect(from.toISOString()).toBe('2026-07-01T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-01T05:00:00.000Z');
  });

  it('la cabecera lleva periodo, generacion y el criterio impreso', async () => {
    const { service } = make({});
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'AMBOS' });
    expect(v.period).toEqual({ year: 2026, month: 7 });
    expect(v.generatedAt).toBeTruthy();
    expect(v.criteria).toMatch(/creados/i);
  });

  // El punto que la revision del calculo pidio explicitamente: sin esta
  // frase, dos descargas del mismo mes con numeros distintos no se pueden
  // explicar, porque el veredicto de cada fila es sobre el estado actual, no
  // sobre una foto fija de cuando el mes cerro.
  it('el criterio dice que los veredictos reflejan el estado actual, no el cierre del periodo', async () => {
    const { service } = make({});
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'AMBOS' });
    expect(v.criteria).toMatch(/estado actual/i);
  });

  it('resuelve el nombre del cliente contra ClientsService, por su razon social', async () => {
    const { service, clients } = make({});
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'TICKETS' });
    expect(clients.findByIdOrFail).toHaveBeenCalledWith(7);
    expect(v.clientName).toBe('Cliente de Prueba S.A.C.');
  });

  it('degrada a clientName null si el cliente ya no existe, sin tumbar el informe', async () => {
    const { service, clients } = make({});
    clients.findByIdOrFail.mockRejectedValue(new NotFoundException({ code: 'NOT_FOUND', message: 'x' }));
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'TICKETS' });
    expect(v.clientName).toBeNull();
  });

  it('publica los tickets con el estado ya traducido, nunca el valor crudo del enum', async () => {
    const { service } = make({
      ticketRows: [
        {
          id: 1, code: 'TK-0001', subject: 'Algo falla', serviceCategory: 'SOPORTE',
          priority: 'P3', status: 'EN_ATENCION',
          capturedAt: new Date('2026-07-05T14:00:00Z'),
          firstResponseAt: null, resolvedAt: null,
          slaResponseDueAt: null, slaResolutionDueAt: null,
        } as Partial<Ticket>,
      ],
    });
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'TICKETS' });
    expect(v.tickets!.rows[0].status).toBe('En atención');
  });

  it('publica los requerimientos con el estado ya traducido, nunca el valor crudo del enum', async () => {
    const { service } = make({
      requirementRows: [
        {
          id: 1, code: 'RQ-0001', title: 'Exportar a Excel', status: 'EN_PROCESO',
          createdAt: new Date('2026-07-05T14:00:00Z'), dueDate: null, closedAt: null,
        } as Partial<WorkItem>,
      ],
    });
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'REQUERIMIENTOS' });
    expect(v.requirements!.rows[0].status).toBe('En desarrollo');
  });

  // El bloque no pedido viaja como `null` hasta la vista final, no como una
  // lista vacia: «no lo pediste» y «no hubo nada» son cosas distintas.
  it('el bloque no pedido llega como null hasta la vista, no como lista vacia', async () => {
    const { service } = make({});
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'TICKETS' });
    expect(v.requirements).toBeNull();
    expect(v.tickets).not.toBeNull();
  });
});
