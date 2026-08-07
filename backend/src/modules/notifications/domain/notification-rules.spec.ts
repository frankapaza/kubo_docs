import { plansForEvent, TicketNotificationEvent } from './notification-rules';
import { TicketEventType, TICKET_EVENT_TYPES } from '../../tickets/entities/ticket-event.entity';
import { TICKET_ORIGINS } from '../../tickets/entities/ticket.entity';
import { TICKET_STATUSES, TicketStatus } from '../../tickets/domain/ticket-state-machine';

/** Evento base: ticket abierto por el cliente, origen portal, sin responsable. */
function baseEvent(overrides: Partial<TicketNotificationEvent> = {}): TicketNotificationEvent {
  return {
    type: 'CREATED',
    toStatus: 'NUEVO',
    origin: 'PORTAL',
    hasClientAuthor: true,
    hasAssignee: false,
    messageVisibility: null,
    actorKind: 'CLIENT',
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

  /**
   * `MESSAGE_POSTED` entra aquí como uno más de los que no notifican, y es
   * correcto: `baseEvent` lo construye sin visibilidad de mensaje, y sin ella
   * las reglas del hilo no se disparan. El aviso de mensaje exige `PUBLICA`
   * **y** un autor identificado; lo prueban los bloques del final.
   */
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

// ---------------------------------------------------------------------------
// El hilo de mensajes (migración 018)
// ---------------------------------------------------------------------------

/**
 * Un `MESSAGE_POSTED` tal y como lo escribe `TicketMessagesService.post`: sin
 * estado destino (no cambia de estado) y con la visibilidad y el autor que el
 * despachador saca de la fila del evento.
 */
function unMensaje(overrides: Partial<TicketNotificationEvent> = {}): TicketNotificationEvent {
  return baseEvent({
    type: 'MESSAGE_POSTED',
    toStatus: null,
    origin: 'PORTAL',
    messageVisibility: 'PUBLICA',
    actorKind: 'CLIENT',
    ...overrides,
  });
}

describe('plansForEvent -- mensajes públicos del hilo', () => {
  it('un mensaje público del cliente avisa al equipo', () => {
    expect(plansForEvent(unMensaje({ actorKind: 'CLIENT' }))).toEqual([
      { triggerKey: 'TICKET_MESSAGE_FROM_CLIENT', audience: 'TEAM' },
    ]);
  });

  /**
   * Y solo al equipo. Devolverle al cliente un correo por su propio mensaje es
   * el clásico eco de las bandejas automáticas: ruido que además le confirma
   * que su texto salió del portal.
   */
  it('un mensaje público del cliente no le devuelve ningún correo al propio cliente', () => {
    const plan = plansForEvent(unMensaje({ actorKind: 'CLIENT' }));
    expect(plan.filter((p) => p.audience === 'CLIENT')).toEqual([]);
  });

  it('un mensaje público del equipo avisa al autor del ticket', () => {
    expect(plansForEvent(unMensaje({ actorKind: 'TEAM' }))).toEqual([
      { triggerKey: 'TICKET_MESSAGE_FROM_TEAM', audience: 'CLIENT' },
    ]);
  });

  /** Y solo a él: el equipo no se avisa a sí mismo de lo que acaba de escribir. */
  it('un mensaje público del equipo no genera además un aviso de equipo', () => {
    const plan = plansForEvent(unMensaje({ actorKind: 'TEAM' }));
    expect(plan.filter((p) => p.audience === 'TEAM')).toEqual([]);
  });

  it('un mensaje del equipo en un ticket sin autor de cliente no avisa a nadie', () => {
    expect(plansForEvent(unMensaje({ actorKind: 'TEAM', hasClientAuthor: false }))).toEqual([]);
  });

  /**
   * Que haya responsable o no **no decide si el aviso se produce**, igual que
   * en `SLA_AT_RISK`: solo decide, ya fuera de este módulo, a qué dirección
   * concreta llega (al responsable o al buzón del equipo).
   */
  it.each([true, false])(
    'el aviso al equipo sale con hasAssignee=%s: el destinatario lo decide el despachador',
    (hasAssignee) => {
      expect(plansForEvent(unMensaje({ actorKind: 'CLIENT', hasAssignee }))).toEqual([
        { triggerKey: 'TICKET_MESSAGE_FROM_CLIENT', audience: 'TEAM' },
      ]);
    },
  );

  /**
   * Decisión tomada y con test propio: el mensaje de un cliente avisa al equipo
   * **en cualquier estado del ticket, RESUELTO incluido**. Es justo el caso del
   * cliente que responde «sigue fallando» a un ticket que el equipo dio por
   * terminado; sin este aviso, ese mensaje cae donde nadie lo lee, que es el
   * mismo argumento con el que se rechazan los mensajes en tickets cerrados.
   *
   * Las reglas no reciben el estado del ticket, así que aquí solo se puede
   * demostrar que ninguna combinación de `toStatus` lo apaga; que el ticket
   * pueda estar en `RESUELTO` de verdad lo prueba el despachador.
   */
  it.each([null, ...TICKET_STATUSES] as Array<TicketStatus | null>)(
    'el aviso al equipo no depende del estado (toStatus=%s)',
    (toStatus) => {
      expect(plansForEvent(unMensaje({ actorKind: 'CLIENT', toStatus }))).toEqual([
        { triggerKey: 'TICKET_MESSAGE_FROM_CLIENT', audience: 'TEAM' },
      ]);
    },
  );

  it.each(TICKET_ORIGINS)('el aviso al equipo tampoco depende del origen (%s)', (origin) => {
    expect(plansForEvent(unMensaje({ actorKind: 'CLIENT', origin }))).toEqual([
      { triggerKey: 'TICKET_MESSAGE_FROM_CLIENT', audience: 'TEAM' },
    ]);
  });
});

/**
 * La regla que no puede fallar, con su propio bloque.
 *
 * Una nota interna escribe **el mismo** `MESSAGE_POSTED` que una respuesta
 * pública —`ticket_messages.visibility` es lo único que las separa—, así que
 * unas reglas que miraran solo el tipo de evento le mandarían al cliente un
 * correo sobre una nota que el portal se cuida de no enseñarle. Y al revés: un
 * aviso al equipo por su propia nota es ruido puro.
 *
 * No se deja en manos del cuidado de quien escriba el código mañana: se
 * comprueba a fuerza bruta sobre todas las combinaciones que las reglas
 * distinguen.
 */
describe('plansForEvent -- una nota interna no avisa a nadie', () => {
  it('la nota interna del equipo no avisa al cliente', () => {
    const plan = plansForEvent(unMensaje({ actorKind: 'TEAM', messageVisibility: 'INTERNA' }));
    expect(plan.filter((p) => p.audience === 'CLIENT')).toEqual([]);
  });

  it('la nota interna del equipo tampoco avisa al equipo: es el aviso que parece inofensivo', () => {
    const plan = plansForEvent(unMensaje({ actorKind: 'TEAM', messageVisibility: 'INTERNA' }));
    expect(plan.filter((p) => p.audience === 'TEAM')).toEqual([]);
  });

  it('no avisa a nadie en ninguna combinación de autor, origen, estado, autor de cliente y responsable', () => {
    const estados: Array<TicketStatus | null> = [null, ...TICKET_STATUSES];

    for (const actorKind of ['CLIENT', 'TEAM', null] as const) {
      for (const origin of TICKET_ORIGINS) {
        for (const toStatus of estados) {
          for (const hasClientAuthor of [true, false]) {
            for (const hasAssignee of [true, false]) {
              const plan = plansForEvent(
                unMensaje({
                  messageVisibility: 'INTERNA',
                  actorKind,
                  origin,
                  toStatus,
                  hasClientAuthor,
                  hasAssignee,
                }),
              );
              expect(plan).toEqual([]);
            }
          }
        }
      }
    }
  });

  /**
   * Y la lista blanca falla hacia el silencio también cuando el dato falta: un
   * evento de mensaje cuya visibilidad no se pudo leer no se trata como
   * pública. Al revés —tratar lo desconocido como público— es exactamente cómo
   * una nota interna acabaría en el correo de un cliente el día en que el
   * `payload` de la fila llegue incompleto.
   */
  it('un mensaje sin visibilidad legible no avisa a nadie', () => {
    expect(plansForEvent(unMensaje({ messageVisibility: null, actorKind: 'CLIENT' }))).toEqual([]);
    expect(plansForEvent(unMensaje({ messageVisibility: null, actorKind: 'TEAM' }))).toEqual([]);
  });

  it('un mensaje público sin autor identificable no avisa a nadie', () => {
    expect(plansForEvent(unMensaje({ messageVisibility: 'PUBLICA', actorKind: null }))).toEqual([]);
  });

  /**
   * La visibilidad solo se mira en los eventos de mensaje: una fila de otro
   * tipo con `PUBLICA` colgando del `payload` no puede colarse por esta puerta.
   */
  it.each(TICKET_EVENT_TYPES.filter((t) => t !== 'MESSAGE_POSTED'))(
    'un evento %s con visibilidad PUBLICA no dispara ningún aviso de mensaje',
    (type) => {
      const plan = plansForEvent(
        baseEvent({ type, toStatus: null, messageVisibility: 'PUBLICA', actorKind: 'CLIENT' }),
      );
      expect(plan.map((p) => p.triggerKey)).not.toContain('TICKET_MESSAGE_FROM_CLIENT');
      expect(plan.map((p) => p.triggerKey)).not.toContain('TICKET_MESSAGE_FROM_TEAM');
    },
  );
});
