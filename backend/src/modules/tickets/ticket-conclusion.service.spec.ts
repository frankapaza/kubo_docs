import { BadRequestException } from '@nestjs/common';

import { TicketConclusionService } from './ticket-conclusion.service';
import { TicketStatus } from './domain/ticket-state-machine';

/**
 * Simula el ticket en memoria: assign/take/transition cambian su estado como
 * lo harían los servicios reales, así la prueba ve el recorrido completo.
 */
function build(status: TicketStatus, over: { assigneeUserId?: number | null; failAt?: TicketStatus } = {}) {
  const ticket = {
    id: 7,
    status,
    assigneeUserId: over.assigneeUserId ?? null,
  } as { id: number; status: TicketStatus; assigneeUserId: number | null };
  const path: string[] = [];

  const repo = { findById: jest.fn(async () => ({ ...ticket })) };
  const assignment = {
    assign: jest.fn(async (i: { assigneeUserId: number }) => {
      ticket.assigneeUserId = i.assigneeUserId;
      ticket.status = 'ASIGNADO';
      path.push('ASIGNADO');
      return { ...ticket };
    }),
  };
  const transitions = {
    transition: jest.fn(async (i: { toStatus: TicketStatus }) => {
      if (over.failAt === i.toStatus) throw new Error('falló');
      ticket.status = i.toStatus;
      path.push(i.toStatus);
      return { ...ticket };
    }),
  };
  const service = new TicketConclusionService(repo as never, assignment as never, transitions as never);
  return { service, ticket, path, assignment, transitions };
}

const BODY = { ticketId: 7, actorUserId: 5, solucion: 'Se corrigió en la versión 2.3' };

describe('TicketConclusionService.conclude', () => {
  it('un ticket Nuevo recorre asignado → en atención → resuelto → cerrado', async () => {
    const { service, path, assignment } = build('NUEVO');
    const out = await service.conclude(BODY);
    expect(path).toEqual(['ASIGNADO', 'EN_ATENCION', 'RESUELTO', 'CERRADO']);
    expect(assignment.assign).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserId: 5, actorUserId: 5 }));
    expect(out.status).toBe('CERRADO');
  });

  it('conserva al responsable que ya tenía', async () => {
    const { service, assignment } = build('TRIAJE', { assigneeUserId: 9 });
    await service.conclude(BODY);
    expect(assignment.assign).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserId: 9 }));
  });

  it('resuelve con la observación como solución y completa causa y acción si faltan', async () => {
    const { service, transitions } = build('EN_ATENCION');
    await service.conclude(BODY);
    expect(transitions.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        toStatus: 'RESUELTO',
        resolutionMd: 'Se corrigió en la versión 2.3',
        rootCause: expect.stringMatching(/sin registrar/i),
        correctiveAction: expect.stringMatching(/sin registrar/i),
      }),
    );
  });

  it('usa la causa raíz y la acción correctiva cuando vienen', async () => {
    const { service, transitions } = build('EN_ATENCION');
    await service.conclude({ ...BODY, rootCause: 'Validación faltante', correctiveAction: 'Prueba agregada' });
    expect(transitions.transition).toHaveBeenCalledWith(
      expect.objectContaining({ rootCause: 'Validación faltante', correctiveAction: 'Prueba agregada' }),
    );
  });

  it('Espera cliente se resuelve directo', async () => {
    const { service, path } = build('ESPERA_CLIENTE');
    await service.conclude(BODY);
    expect(path).toEqual(['RESUELTO', 'CERRADO']);
  });

  it('Derivado vuelve a en atención antes de resolver', async () => {
    const { service, path } = build('DERIVADO', { assigneeUserId: 9 });
    await service.conclude(BODY);
    expect(path).toEqual(['EN_ATENCION', 'RESUELTO', 'CERRADO']);
  });

  it('un Resuelto solo se cierra', async () => {
    const { service, path } = build('RESUELTO');
    await service.conclude(BODY);
    expect(path).toEqual(['CERRADO']);
  });

  it('un Cerrado se rechaza sin tocar nada', async () => {
    const { service, transitions } = build('CERRADO');
    await expect(service.conclude(BODY)).rejects.toBeInstanceOf(BadRequestException);
    expect(transitions.transition).not.toHaveBeenCalled();
  });

  it('exige la observación', async () => {
    const { service, transitions } = build('NUEVO');
    await expect(service.conclude({ ...BODY, solucion: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(transitions.transition).not.toHaveBeenCalled();
  });

  it('si un paso falla, reintentar sigue desde donde quedó', async () => {
    const { service, path } = build('NUEVO', { failAt: 'RESUELTO' });
    await expect(service.conclude(BODY)).rejects.toThrow('falló');
    expect(path).toEqual(['ASIGNADO', 'EN_ATENCION']);
  });
});
