import { plansForEvent, TicketNotificationEvent } from './notification-rules';
import { TicketEventType, TICKET_EVENT_TYPES } from '../../tickets/entities/ticket-event.entity';

/** Evento base: ticket abierto por el cliente, origen portal, sin responsable. */
function baseEvent(overrides: Partial<TicketNotificationEvent> = {}): TicketNotificationEvent {
  return {
    type: 'CREATED',
    toStatus: 'NUEVO',
    origin: 'PORTAL',
    hasClientAuthor: true,
    hasAssignee: false,
    ...overrides,
  };
}

describe('plansForEvent -- avisos al cliente', () => {
  it('la creación del ticket avisa al cliente', () => {
    const plan = plansForEvent(baseEvent({ type: 'CREATED', toStatus: 'NUEVO', origin: 'EMAIL' }));
    expect(plan).toContainEqual({ triggerKey: 'TICKET_CREATED', audience: 'CLIENT' });
  });

  it('pasar a ESPERA_CLIENTE avisa al cliente', () => {
    const plan = plansForEvent(
      baseEvent({ type: 'STATUS_CHANGED', toStatus: 'ESPERA_CLIENTE', origin: 'EMAIL' }),
    );
    expect(plan).toEqual([{ triggerKey: 'TICKET_WAITING_CLIENT', audience: 'CLIENT' }]);
  });

  it('RESUELTO avisa al cliente', () => {
    const plan = plansForEvent(baseEvent({ type: 'RESOLVED', toStatus: 'RESUELTO', origin: 'EMAIL' }));
    expect(plan).toEqual([{ triggerKey: 'TICKET_RESOLVED', audience: 'CLIENT' }]);
  });

  it('CERRADO avisa al cliente', () => {
    const plan = plansForEvent(baseEvent({ type: 'CLOSED', toStatus: 'CERRADO', origin: 'EMAIL' }));
    expect(plan).toEqual([{ triggerKey: 'TICKET_CLOSED', audience: 'CLIENT' }]);
  });

  it('reabrir avisa al cliente', () => {
    const plan = plansForEvent(
      baseEvent({ type: 'REOPENED', toStatus: 'EN_ATENCION', origin: 'EMAIL' }),
    );
    expect(plan).toEqual([{ triggerKey: 'TICKET_REOPENED', audience: 'CLIENT' }]);
  });
});

describe('plansForEvent -- lista blanca, no lista negra', () => {
  it('pasar a TRIAJE no notifica: es tentador, pero no está en la tabla', () => {
    const plan = plansForEvent(
      baseEvent({ type: 'TRIAGED', toStatus: 'TRIAJE', origin: 'EMAIL' }),
    );
    expect(plan).toEqual([]);
  });

  it('pasar a ASIGNADO no notifica: es tentador, pero no está en la tabla', () => {
    const plan = plansForEvent(
      baseEvent({ type: 'STATUS_CHANGED', toStatus: 'ASIGNADO', origin: 'EMAIL' }),
    );
    expect(plan).toEqual([]);
  });

  it('tomar el ticket (ASIGNADO -> EN_ATENCION) no notifica', () => {
    const plan = plansForEvent(baseEvent({ type: 'TAKEN', toStatus: 'EN_ATENCION', origin: 'EMAIL' }));
    expect(plan).toEqual([]);
  });

  it('derivar el ticket no notifica', () => {
    const plan = plansForEvent(baseEvent({ type: 'ESCALATED', toStatus: 'DERIVADO', origin: 'EMAIL' }));
    expect(plan).toEqual([]);
  });

  it.each(['ASSIGNED', 'COMMENT', 'PRIORITY_OVERRIDDEN'] as TicketEventType[])(
    'el tipo %s, que el portal ya excluye del timeline, tampoco produce ningún aviso de cliente',
    (type) => {
      const plan = plansForEvent(baseEvent({ type, toStatus: null, origin: 'EMAIL' }));
      expect(plan.filter((p) => p.audience === 'CLIENT')).toEqual([]);
    },
  );

  it('ningún tipo del enum fuera de los cinco listados produce aviso de cliente, con cualquier estado destino', () => {
    const clientTriggering: TicketEventType[] = ['CREATED', 'RESOLVED', 'CLOSED', 'REOPENED'];
    const nonTriggering = TICKET_EVENT_TYPES.filter((t) => !clientTriggering.includes(t));

    for (const type of nonTriggering) {
      const plan = plansForEvent(baseEvent({ type, toStatus: 'ESPERA_CLIENTE', origin: 'EMAIL' }));
      // STATUS_CHANGED hacia ESPERA_CLIENTE sí notifica; el resto de tipos, no,
      // aunque el estado destino coincida por casualidad con el que sí importa.
      if (type === 'STATUS_CHANGED') {
        expect(plan.filter((p) => p.audience === 'CLIENT')).toEqual([
          { triggerKey: 'TICKET_WAITING_CLIENT', audience: 'CLIENT' },
        ]);
      } else {
        expect(plan.filter((p) => p.audience === 'CLIENT')).toEqual([]);
      }
    }
  });
});

describe('plansForEvent -- sin autor de cliente, ningún aviso de cliente', () => {
  it('la creación sin autor de cliente no avisa al cliente, aunque el tipo sí notifique normalmente', () => {
    const plan = plansForEvent(
      baseEvent({ type: 'CREATED', toStatus: 'NUEVO', origin: 'NOTE', hasClientAuthor: false }),
    );
    expect(plan.filter((p) => p.audience === 'CLIENT')).toEqual([]);
  });

  it('un RESUELTO sin autor de cliente no avisa al cliente', () => {
    const plan = plansForEvent(
      baseEvent({ type: 'RESOLVED', toStatus: 'RESUELTO', origin: 'NOTE', hasClientAuthor: false }),
    );
    expect(plan).toEqual([]);
  });

  it('sin autor de cliente, el aviso al equipo por alta desde el portal se mantiene intacto', () => {
    const plan = plansForEvent(
      baseEvent({ type: 'CREATED', toStatus: 'NUEVO', origin: 'PORTAL', hasClientAuthor: false }),
    );
    expect(plan).toEqual([{ triggerKey: 'TICKET_CREATED_PORTAL', audience: 'TEAM' }]);
  });
});

describe('plansForEvent -- avisos al equipo', () => {
  it('un alta con origen PORTAL avisa al equipo', () => {
    const plan = plansForEvent(baseEvent({ type: 'CREATED', toStatus: 'NUEVO', origin: 'PORTAL' }));
    expect(plan).toContainEqual({ triggerKey: 'TICKET_CREATED_PORTAL', audience: 'TEAM' });
  });

  it.each(['EMAIL', 'WHATSAPP_TEXT', 'WHATSAPP_AUDIO', 'VOICE_LIVE', 'MEETING', 'NOTE'] as const)(
    'un alta con origen %s no avisa al equipo',
    (origin) => {
      const plan = plansForEvent(baseEvent({ type: 'CREATED', toStatus: 'NUEVO', origin }));
      expect(plan.filter((p) => p.audience === 'TEAM')).toEqual([]);
    },
  );

  it('un SLA en riesgo avisa al equipo', () => {
    const plan = plansForEvent(
      baseEvent({ type: 'SLA_AT_RISK', toStatus: null, origin: 'EMAIL', hasAssignee: true }),
    );
    expect(plan).toEqual([{ triggerKey: 'SLA_AT_RISK', audience: 'TEAM' }]);
  });

  it('un SLA en riesgo avisa al equipo también sin responsable asignado', () => {
    const plan = plansForEvent(
      baseEvent({ type: 'SLA_AT_RISK', toStatus: null, origin: 'EMAIL', hasAssignee: false }),
    );
    expect(plan).toEqual([{ triggerKey: 'SLA_AT_RISK', audience: 'TEAM' }]);
  });
});

describe('plansForEvent -- un mismo evento, dos públicos', () => {
  it('el alta desde el portal avisa al cliente y al equipo a la vez', () => {
    const plan = plansForEvent(
      baseEvent({ type: 'CREATED', toStatus: 'NUEVO', origin: 'PORTAL', hasClientAuthor: true }),
    );
    expect(plan).toHaveLength(2);
    expect(plan).toContainEqual({ triggerKey: 'TICKET_CREATED', audience: 'CLIENT' });
    expect(plan).toContainEqual({ triggerKey: 'TICKET_CREATED_PORTAL', audience: 'TEAM' });
  });
});
