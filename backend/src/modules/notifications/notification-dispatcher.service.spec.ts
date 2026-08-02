import {
  NotificationDispatchError,
  NotificationDispatcher,
} from './notification-dispatcher.service';
import { CLIENT_VARIABLES, TEAM_VARIABLES } from './domain/template-renderer';

/**
 * Los identificadores van como **cadena** a propósito en todos los dobles:
 * es como TypeORM hidrata las columnas `bigint`, por mucho que la entidad las
 * declare `number`. Si el despachador compara o indexa con `===` estricto,
 * estos tests lo cazan; con ids numéricos "bonitos" pasarían todos y el fallo
 * saldría en producción, mandando el ticket de una empresa a otra.
 */
const TICKET_ID = '13';
const CLIENT_ID = '4';
const CLIENT_USER_ID = '21';
const ASSIGNEE_ID = '7';

const AUTOR_EMAIL = 'ana.quispe@comercialandina.pe';
const RESPONSABLE_EMAIL = 'juana.rios@kuboti.com';
const RESPONSABLE_NOMBRE = 'Juana Ríos';
const BUZON_EQUIPO = 'soporte@kuboti.com';
const REMITENTE = 'Kubo DevDocs <ticket@kuboti.com>';

/** Lo que el cliente no puede ver, con valores reconocibles dentro del correo. */
const MOTIVO_INTERNO = 'el parche se aplicó tras escalar a N3 sin avisar al cliente';
const PRIORIDAD = 'P1';
/** Año distinto al del evento: cualquier rastro del plazo de SLA se ve solo. */
const SLA_DUE = new Date('2027-03-15T09:00:00Z');
const EVENT_AT = new Date('2026-08-02T15:30:00Z');

/**
 * Ticket con **todos** los datos sensibles rellenos. Es deliberado: un ticket
 * sin prioridad, sin plazo, sin responsable y sin motivo haría pasar el test
 * de fuga sin probar nada.
 */
function unTicket(overrides: Record<string, unknown> = {}): any {
  return {
    id: TICKET_ID,
    code: 'TKT-0013',
    subject: 'No carga el módulo de caja',
    status: 'RESUELTO',
    origin: 'PORTAL',
    priority: PRIORIDAD,
    slaResolutionDueAt: SLA_DUE,
    assigneeUserId: ASSIGNEE_ID,
    clientId: CLIENT_ID,
    createdByClientUserId: CLIENT_USER_ID,
    ...overrides,
  };
}

function unEvento(overrides: Record<string, unknown> = {}): any {
  return {
    id: '901',
    ticketId: TICKET_ID,
    type: 'RESOLVED',
    fromStatus: 'EN_ATENCION',
    toStatus: 'RESUELTO',
    actorUserId: ASSIGNEE_ID,
    actorClientUserId: null,
    reason: MOTIVO_INTERNO,
    payload: null,
    createdAt: EVENT_AT,
    ...overrides,
  };
}

/** Plantilla de cliente con las seis variables de su público, ninguna más. */
const PLANTILLA_CLIENTE = {
  id: 3,
  triggerKey: 'TICKET_RESOLVED',
  audience: 'CLIENT',
  subject: '[{{codigo}}] Ya está resuelto: {{asunto}}',
  bodyMd:
    'Hola,\n\nTerminamos de atender tu ticket **{{codigo}}** el {{fecha}}.\n\n' +
    '- **Asunto:** {{asunto}}\n- **Estado:** {{estado}}\n- **Empresa:** {{razon_social}}\n\n' +
    'Revísalo en el portal:\n{{enlace_portal}}\n\nEste correo es automático y no se puede responder.',
  isActive: 1,
};

const PLANTILLA_EQUIPO_ALTA = {
  id: 6,
  triggerKey: 'TICKET_CREATED_PORTAL',
  audience: 'TEAM',
  subject: '[{{codigo}}] Ticket nuevo desde el portal — {{razon_social}}',
  bodyMd:
    'Entró un ticket nuevo el {{fecha}}.\n\n- **Prioridad:** {{prioridad}}\n' +
    '- **Vence:** {{sla}}\n- **Responsable:** {{responsable}}\n\n{{enlace_panel}}',
  isActive: 1,
};

const PLANTILLA_EQUIPO_SLA = {
  id: 7,
  triggerKey: 'SLA_AT_RISK',
  audience: 'TEAM',
  subject: '[{{codigo}}] SLA en riesgo — {{razon_social}}',
  bodyMd:
    'El SLA de **{{codigo}}** está por vencer.\n\n- **Prioridad:** {{prioridad}}\n' +
    '- **Vence:** {{sla}}\n- **Responsable:** {{responsable}}\n- **Detalle:** {{motivo}}\n\n{{enlace_panel}}',
  isActive: 1,
};

const PLANTILLA_CLIENTE_ALTA = {
  id: 1,
  triggerKey: 'TICKET_CREATED',
  audience: 'CLIENT',
  subject: '[{{codigo}}] Recibimos tu solicitud: {{asunto}}',
  bodyMd: 'Recibimos tu solicitud el {{fecha}}. Estado: {{estado}}. {{enlace_portal}}',
  isActive: 1,
};

interface Opciones {
  ticket?: any | null;
  plantillas?: any[];
  clientUser?: any | null;
  assignee?: any | null;
  teamInbox?: string | null;
  smtpFrom?: string | null;
  cliente?: any | null;
  enviaOk?: boolean;
  /** Dirección concreta cuyo envío rebota, para montar un envío parcial. */
  fallaPara?: string | null;
  /** `null` = la variable de entorno no está puesta. */
  frontendUrl?: string | null;
  /** Resto de variables de entorno visibles para el despachador. */
  env?: Record<string, string>;
}

function montar(opciones: Opciones = {}) {
  const {
    ticket = unTicket(),
    plantillas = [PLANTILLA_CLIENTE, PLANTILLA_EQUIPO_ALTA, PLANTILLA_EQUIPO_SLA, PLANTILLA_CLIENTE_ALTA],
    clientUser = {
      id: CLIENT_USER_ID,
      clientId: CLIENT_ID,
      email: AUTOR_EMAIL,
      fullName: 'Ana Quispe',
      isActive: 1,
    },
    assignee = {
      id: ASSIGNEE_ID,
      email: RESPONSABLE_EMAIL,
      fullName: RESPONSABLE_NOMBRE,
      isActive: 1,
    },
    teamInbox = BUZON_EQUIPO,
    smtpFrom = REMITENTE,
    cliente = { id: CLIENT_ID, razonSocial: 'Comercial Andina SAC' },
    enviaOk = true,
    fallaPara = null,
    frontendUrl = 'https://docs.kuboti.com',
    env = {},
  } = opciones;

  const tickets = {
    findById: jest.fn((id: number) =>
      Promise.resolve(ticket && Number(ticket.id) === Number(id) ? ticket : null),
    ),
  };
  const clients = {
    findById: jest.fn((id: number) =>
      Promise.resolve(cliente && Number(cliente.id) === Number(id) ? cliente : null),
    ),
  };
  const clientUsers = {
    findById: jest.fn((id: number) =>
      Promise.resolve(clientUser && Number(clientUser.id) === Number(id) ? clientUser : null),
    ),
  };
  const users = {
    findById: jest.fn((id: number) =>
      Promise.resolve(assignee && Number(assignee.id) === Number(id) ? assignee : null),
    ),
  };
  const workspace = {
    getTeamInboxEmail: jest.fn(() => Promise.resolve(teamInbox)),
    getSmtpConfig: jest.fn(() =>
      Promise.resolve(smtpFrom ? { host: 'mail.kuboti.com', port: 465, secure: true, user: 'ticket@kuboti.com', pass: 'x', from: smtpFrom } : null),
    ),
  };
  const templates = {
    findActive: jest.fn((triggerKey: string, audience: string) =>
      Promise.resolve(
        plantillas.find(
          (p) => p.triggerKey === triggerKey && p.audience === audience && p.isActive === 1,
        ) ?? null,
      ),
    ),
  };
  const email = {
    send: jest.fn((input: any) =>
      enviaOk && (fallaPara === null || input.to !== fallaPara)
        ? Promise.resolve({ messageId: '<1@kuboti.com>', accepted: [], rejected: [] })
        : Promise.reject(new Error(`SMTP no responde (${String(input.to)})`)),
    ),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'FRONTEND_URL' ? frontendUrl ?? undefined : env[key],
    ),
  };

  const dispatcher = new NotificationDispatcher(
    tickets as any,
    clients as any,
    clientUsers as any,
    users as any,
    workspace as any,
    templates as any,
    email as any,
    config as any,
  );

  return { dispatcher, email, templates, tickets, clientUsers, users, workspace };
}

/** Los correos que de verdad se pasaron a `EmailService.send`. */
function enviados(email: { send: jest.Mock }): any[] {
  return email.send.mock.calls.map((c) => c[0]);
}

// ---------------------------------------------------------------------------
// La fuga: el test que sostiene la regla 2 de la funcionalidad
// ---------------------------------------------------------------------------

describe('el correo al cliente no lleva nada que el portal le oculte', () => {
  it('ni la prioridad, ni el plazo de SLA, ni el responsable, ni el motivo — sobre el subject y el html reales', async () => {
    const { dispatcher, email } = montar();

    await dispatcher.dispatchForEvent(unEvento());

    expect(email.send).toHaveBeenCalledTimes(1);
    const [correo] = enviados(email);
    expect(correo.to).toBe(AUTOR_EMAIL);

    // Todo lo que se le manda, junto: asunto, cuerpo HTML y cuerpo de texto.
    const todo = `${correo.subject}\n${correo.html}\n${correo.text ?? ''}`;

    expect(todo).not.toContain(PRIORIDAD); // prioridad
    expect(todo).not.toContain('2027'); // el año del plazo de SLA, y solo del plazo
    expect(todo).not.toContain(RESPONSABLE_NOMBRE); // responsable
    expect(todo).not.toContain(RESPONSABLE_EMAIL);
    expect(todo).not.toContain(MOTIVO_INTERNO); // motivo de la transición
    expect(todo).not.toContain('N3'); // nivel de escalado, dentro del motivo
  });

  it('tampoco si la plantilla de cliente intentara usar variables de equipo', async () => {
    const plantillaTramposa = {
      ...PLANTILLA_CLIENTE,
      subject: '[{{codigo}}] {{prioridad}}',
      bodyMd: 'Motivo: {{motivo}} · Vence: {{sla}} · Técnico: {{responsable}}',
    };
    const { dispatcher, email } = montar({
      plantillas: [plantillaTramposa, PLANTILLA_EQUIPO_ALTA, PLANTILLA_EQUIPO_SLA],
    });

    await dispatcher.dispatchForEvent(unEvento());

    const [correo] = enviados(email);
    const todo = `${correo.subject}\n${correo.html}\n${correo.text ?? ''}`;
    expect(todo).not.toContain(PRIORIDAD);
    expect(todo).not.toContain('2027');
    expect(todo).not.toContain(RESPONSABLE_NOMBRE);
    expect(todo).not.toContain(MOTIVO_INTERNO);
  });

  it('no se le manda la plantilla del otro público aunque exista para el mismo aviso', async () => {
    // Mismo `triggerKey`, público TEAM. Buscar la plantilla por la clave y
    // olvidarse del público le mandaría al cliente el texto interno entero.
    const gemelaDeEquipo = {
      id: 99,
      triggerKey: 'TICKET_RESOLVED',
      audience: 'TEAM',
      subject: 'USO INTERNO — {{codigo}}',
      bodyMd: 'Notas internas del cierre: {{motivo}}. Responsable {{responsable}}.',
      isActive: 1,
    };
    const { dispatcher, email } = montar({ plantillas: [PLANTILLA_CLIENTE, gemelaDeEquipo] });

    await dispatcher.dispatchForEvent(unEvento());

    const [correo] = enviados(email);
    expect(`${correo.subject}\n${correo.html}`).not.toContain('USO INTERNO');
    expect(`${correo.subject}\n${correo.html}`).not.toContain(MOTIVO_INTERNO);
  });

  it('el correo del equipo sí lleva esos datos: si no, el test de arriba no probaría nada', async () => {
    const { dispatcher, email } = montar();

    await dispatcher.dispatchForEvent(
      unEvento({ type: 'SLA_AT_RISK', fromStatus: null, toStatus: null }),
    );

    const [correo] = enviados(email);
    const todo = `${correo.subject}\n${correo.html}`;
    expect(todo).toContain(PRIORIDAD);
    expect(todo).toContain('2027');
    expect(todo).toContain(RESPONSABLE_NOMBRE);
    expect(todo).toContain(MOTIVO_INTERNO);
  });
});

// ---------------------------------------------------------------------------
// Destinatarios
// ---------------------------------------------------------------------------

describe('a quién se le escribe', () => {
  it('al cliente: solo al autor del ticket', async () => {
    const { dispatcher, email, clientUsers } = montar();
    await dispatcher.dispatchForEvent(unEvento());

    expect(clientUsers.findById).toHaveBeenCalledWith(Number(CLIENT_USER_ID));
    expect(enviados(email).map((c) => c.to)).toEqual([AUTOR_EMAIL]);
  });

  it('un ticket sin autor de cliente no llama a EmailService.send ni una vez', async () => {
    const { dispatcher, email } = montar({
      ticket: unTicket({ createdByClientUserId: null }),
    });

    const resultado = await dispatcher.dispatchForEvent(unEvento());

    expect(email.send).not.toHaveBeenCalled();
    expect(resultado.sent).toBe(0);
    expect(resultado.skipped).not.toBeNull();
  });

  it('un autor de cliente desactivado tampoco recibe nada', async () => {
    const { dispatcher, email } = montar({
      clientUser: {
        id: CLIENT_USER_ID,
        clientId: CLIENT_ID,
        email: AUTOR_EMAIL,
        fullName: 'Ana Quispe',
        isActive: 0,
      },
    });

    await dispatcher.dispatchForEvent(unEvento());
    expect(email.send).not.toHaveBeenCalled();
  });

  it('un autor que no pertenece a la empresa del ticket no recibe nada', async () => {
    // Hoy no hay camino que lleve aquí —el id sale del propio ticket—, pero es
    // la última comprobación antes de poner una dirección en el `To:`, y lo que
    // hay al otro lado es el ticket de una empresa llegando a otra.
    const { dispatcher, email } = montar({
      clientUser: {
        id: CLIENT_USER_ID,
        clientId: '77', // otra empresa
        email: 'otro@otraempresa.pe',
        fullName: 'Alguien de otra empresa',
        isActive: 1,
      },
    });

    const resultado = await dispatcher.dispatchForEvent(unEvento());

    expect(email.send).not.toHaveBeenCalled();
    expect(resultado.sent).toBe(0);
  });

  it('tampoco si el ticket no tiene empresa: dos nulos no son una coincidencia', async () => {
    const { dispatcher, email } = montar({
      ticket: unTicket({ clientId: null }),
      clientUser: {
        id: CLIENT_USER_ID,
        clientId: null,
        email: AUTOR_EMAIL,
        fullName: 'Ana Quispe',
        isActive: 1,
      },
    });

    await dispatcher.dispatchForEvent(unEvento());
    expect(email.send).not.toHaveBeenCalled();
  });

  it('SLA en riesgo con responsable asignado: va al responsable', async () => {
    const { dispatcher, email } = montar();
    await dispatcher.dispatchForEvent(unEvento({ type: 'SLA_AT_RISK', toStatus: null }));

    expect(enviados(email).map((c) => c.to)).toEqual([RESPONSABLE_EMAIL]);
  });

  it('SLA en riesgo con el responsable dado de baja: cae al buzón del equipo', async () => {
    // Es correo interno, pero es la misma puerta que se le cierra al usuario de
    // cliente desactivado. Y el buzón es justo quien debe enterarse de un SLA
    // en riesgo cuyo responsable ya no está.
    const { dispatcher, email } = montar({
      assignee: {
        id: ASSIGNEE_ID,
        email: RESPONSABLE_EMAIL,
        fullName: RESPONSABLE_NOMBRE,
        isActive: 0,
      },
    });

    await dispatcher.dispatchForEvent(unEvento({ type: 'SLA_AT_RISK', toStatus: null }));
    expect(enviados(email).map((c) => c.to)).toEqual([BUZON_EQUIPO]);
  });

  it('SLA en riesgo sin responsable: va al buzón del equipo', async () => {
    const { dispatcher, email } = montar({ ticket: unTicket({ assigneeUserId: null }) });
    await dispatcher.dispatchForEvent(unEvento({ type: 'SLA_AT_RISK', toStatus: null }));

    expect(enviados(email).map((c) => c.to)).toEqual([BUZON_EQUIPO]);
  });

  it('SLA en riesgo sin responsable y con el buzón vacío: cae al remitente SMTP', async () => {
    const { dispatcher, email } = montar({
      ticket: unTicket({ assigneeUserId: null }),
      teamInbox: null,
    });
    await dispatcher.dispatchForEvent(unEvento({ type: 'SLA_AT_RISK', toStatus: null }));

    expect(enviados(email).map((c) => c.to)).toEqual([REMITENTE]);
  });

  /**
   * Sin fila de SMTP en base, el remitente sale del `.env`. Y ahí las
   * variables llegan vacías, no ausentes: el compose de producción declara
   * `SMTP_FROM: ${SMTP_FROM}` y Compose sustituye por cadena vacía. Con `??`,
   * ese vacío ganaría a `SMTP_USER` y el aviso interno se quedaría sin
   * destinatario en silencio.
   */
  it('con el buzón y SMTP_FROM vacíos, el remitente sale de SMTP_USER', async () => {
    const { dispatcher, email } = montar({
      ticket: unTicket({ assigneeUserId: null }),
      teamInbox: null,
      smtpFrom: null,
      env: { SMTP_FROM: '', SMTP_USER: 'ticket@kuboti.com' },
    });
    await dispatcher.dispatchForEvent(unEvento({ type: 'SLA_AT_RISK', toStatus: null }));

    expect(enviados(email).map((c) => c.to)).toEqual(['ticket@kuboti.com']);
  });

  it('ticket nuevo desde el portal: el aviso de equipo va al buzón, aunque haya responsable', async () => {
    const { dispatcher, email } = montar();
    await dispatcher.dispatchForEvent(
      unEvento({ type: 'CREATED', fromStatus: null, toStatus: 'NUEVO' }),
    );

    const destinos = enviados(email).map((c) => c.to);
    expect(destinos).toContain(BUZON_EQUIPO);
    expect(destinos).not.toContain(RESPONSABLE_EMAIL);
  });

  it('un alta desde el portal produce los dos avisos: al autor y al equipo', async () => {
    const { dispatcher, email } = montar();
    const resultado = await dispatcher.dispatchForEvent(
      unEvento({ type: 'CREATED', fromStatus: null, toStatus: 'NUEVO' }),
    );

    expect(resultado.sent).toBe(2);
    expect(enviados(email).map((c) => c.to).sort()).toEqual([AUTOR_EMAIL, BUZON_EQUIPO].sort());
  });
});

// ---------------------------------------------------------------------------
// Apagar un aviso, y los eventos que no avisan
// ---------------------------------------------------------------------------

describe('cuándo no se envía nada, sin que sea un error', () => {
  it('una plantilla desactivada no envía nada', async () => {
    const { dispatcher, email } = montar({
      plantillas: [{ ...PLANTILLA_CLIENTE, isActive: 0 }],
    });

    const resultado = await dispatcher.dispatchForEvent(unEvento());

    expect(email.send).not.toHaveBeenCalled();
    expect(resultado.sent).toBe(0);
    expect(resultado.skipped).not.toBeNull();
  });

  it('un evento que no genera ningún aviso se salta en silencio', async () => {
    const { dispatcher, email, templates } = montar();
    const resultado = await dispatcher.dispatchForEvent(unEvento({ type: 'COMMENT', toStatus: null }));

    expect(email.send).not.toHaveBeenCalled();
    expect(templates.findActive).not.toHaveBeenCalled();
    expect(resultado.sent).toBe(0);
    expect(resultado.skipped).not.toBeNull();
  });

  it('un evento cuyo ticket ya no existe no revienta: se salta', async () => {
    const { dispatcher, email } = montar({ ticket: null });
    const resultado = await dispatcher.dispatchForEvent(unEvento());

    expect(email.send).not.toHaveBeenCalled();
    expect(resultado.sent).toBe(0);
    expect(resultado.skipped).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// El fallo de envío no se traga
// ---------------------------------------------------------------------------

describe('un destinatario rechazado por el servidor', () => {
  /**
   * `EmailService.send` no lanza cuando el servidor acepta el mensaje pero
   * rechaza a un destinatario: eso viaja en `rejected`. Hoy siempre hay uno
   * solo y nodemailer acaba lanzando, pero sin esta comprobación el día que un
   * aviso vaya a varias direcciones un rebote parcial se sellaría como éxito y
   * el correo se perdería en silencio.
   */
  it('cuenta como fallo aunque el envío no lance, para que el vigilante lo reintente', async () => {
    const { dispatcher, email } = montar();
    email.send.mockResolvedValueOnce({
      messageId: '<1@kuboti.com>',
      accepted: [] as string[],
      rejected: [AUTOR_EMAIL] as string[],
    } as never);

    await expect(dispatcher.dispatchForEvent(unEvento())).rejects.toThrow(AUTOR_EMAIL);
  });

  it('un envío sin rechazos no se toca', async () => {
    const { dispatcher } = montar();

    await expect(dispatcher.dispatchForEvent(unEvento())).resolves.toEqual(
      expect.objectContaining({ sent: 1 }),
    );
  });
});

describe('un fallo de envío', () => {
  it('se propaga al llamador: es el vigilante quien decide reintentar', async () => {
    const { dispatcher } = montar({ enviaOk: false });

    await expect(dispatcher.dispatchForEvent(unEvento())).rejects.toThrow('SMTP no responde');
  });

  it('no se registra como enviado ni se convierte en un "skipped"', async () => {
    const { dispatcher } = montar({ enviaOk: false });
    const resultado = await dispatcher.dispatchForEvent(unEvento()).catch(() => null);

    expect(resultado).toBeNull();
  });

  it('el resto del plan se intenta igualmente: un rebote del cliente no deja al equipo sin enterarse', async () => {
    // Alta desde el portal: dos avisos. El del cliente va primero y rebota.
    const { dispatcher, email } = montar({ fallaPara: AUTOR_EMAIL });

    await dispatcher
      .dispatchForEvent(unEvento({ type: 'CREATED', fromStatus: null, toStatus: 'NUEVO' }))
      .catch(() => null);

    expect(email.send).toHaveBeenCalledTimes(2);
    expect(enviados(email).map((c) => c.to)).toContain(BUZON_EQUIPO);
  });

  it('un envío parcial lanza, y el error dice cuántos salieron y cuáles', async () => {
    const { dispatcher } = montar({ fallaPara: BUZON_EQUIPO });

    const error = await dispatcher
      .dispatchForEvent(unEvento({ type: 'CREATED', fromStatus: null, toStatus: 'NUEVO' }))
      .catch((e) => e);

    expect(error).toBeInstanceOf(NotificationDispatchError);
    expect(error.code).toBe('NOTIFICATION_SEND_ERROR');
    expect(error.sentEntries).toEqual(['TICKET_CREATED/CLIENT']);
    expect(error.failedEntries).toEqual(['TICKET_CREATED_PORTAL/TEAM']);
    expect(error.causes).toHaveLength(1);
    // Quien lea `notify_last_error` tiene que poder saber que el reintento
    // duplicará el correo que sí llegó.
    expect(error.message).toContain('TICKET_CREATED/CLIENT');
    expect(error.message).toContain('TICKET_CREATED_PORTAL/TEAM');
    expect(error.message).toMatch(/repetir/i);
  });

  it('si fallan todos, el error no habla de repeticiones', async () => {
    const { dispatcher } = montar({ enviaOk: false });

    const error = await dispatcher
      .dispatchForEvent(unEvento({ type: 'CREATED', fromStatus: null, toStatus: 'NUEVO' }))
      .catch((e) => e);

    expect(error.sentEntries).toEqual([]);
    expect(error.failedEntries).toHaveLength(2);
    expect(error.message).not.toMatch(/repetir/i);
  });
});

// ---------------------------------------------------------------------------
// Composición del correo
// ---------------------------------------------------------------------------

describe('cómo se compone el correo', () => {
  it('el estado se muestra en español, no con el nombre del enum', async () => {
    const { dispatcher, email } = montar();
    await dispatcher.dispatchForEvent(unEvento());

    const [correo] = enviados(email);
    expect(correo.html).toContain('Resuelto');
    expect(correo.html).not.toContain('RESUELTO');
  });

  it('manda html y también text', async () => {
    const { dispatcher, email } = montar();
    await dispatcher.dispatchForEvent(unEvento());

    const [correo] = enviados(email);
    expect(typeof correo.html).toBe('string');
    expect(typeof correo.text).toBe('string');
    expect(correo.html).toContain('<');
    expect(correo.text).not.toContain('<p>');
  });

  it('el marcado del cuerpo se convierte a html: negritas, viñetas y enlace', async () => {
    const { dispatcher, email } = montar();
    await dispatcher.dispatchForEvent(unEvento());

    const [correo] = enviados(email);
    // La columna se llama body_md y las plantillas sembradas usan este marcado:
    // si no se convierte, el cliente lee los asteriscos y los guiones.
    expect(correo.html).toContain('<strong>TKT-0013</strong>');
    expect(correo.html).toContain('<li><strong>Asunto:</strong>');
    expect(correo.html).toContain(
      `<a href="https://docs.kuboti.com/portal/tickets/${TICKET_ID}">`,
    );
    expect(correo.html).not.toContain('**');
  });

  it('el enlace del cliente apunta al portal y el del equipo al panel', async () => {
    const { dispatcher, email } = montar();
    await dispatcher.dispatchForEvent(
      unEvento({ type: 'CREATED', fromStatus: null, toStatus: 'NUEVO' }),
    );

    const [alCliente, alEquipo] = enviados(email).sort((a, b) =>
      a.to === AUTOR_EMAIL ? -1 : b.to === AUTOR_EMAIL ? 1 : 0,
    );
    expect(alCliente.html).toContain(`https://docs.kuboti.com/portal/tickets/${TICKET_ID}`);
    expect(alEquipo.html).toContain(`https://docs.kuboti.com/tickets/${TICKET_ID}`);
    expect(alEquipo.html).not.toContain('/portal/tickets/');
  });

  it('el contenido que escribe el cliente va escapado en el html y sin escapar en el asunto', async () => {
    const { dispatcher, email } = montar({
      ticket: unTicket({ subject: 'Error <b>grave</b> en "caja" & cierre' }),
    });
    await dispatcher.dispatchForEvent(unEvento());

    const [correo] = enviados(email);
    expect(correo.html).toContain('&lt;b&gt;');
    expect(correo.html).not.toContain('<b>grave</b>');
    // El asunto de un correo es texto plano: ahí las entidades HTML se verían
    // literalmente ("&amp;"), así que se deshacen antes de mandarlo.
    expect(correo.subject).toContain('Error <b>grave</b> en "caja" & cierre');
    expect(correo.subject).not.toContain('&amp;');
    expect(correo.text).not.toContain('&amp;');
  });

  it('el enlace del portal usa el valor por defecto si no hay FRONTEND_URL configurado', async () => {
    const { dispatcher, email } = montar({ frontendUrl: null });

    await dispatcher.dispatchForEvent(unEvento());
    const [correo] = enviados(email);
    expect(correo.html).toContain(`http://localhost:5173/portal/tickets/${TICKET_ID}`);
  });

  it.each([['', 'vacía'], ['   ', 'en blanco']])(
    'una FRONTEND_URL %s (%s) también cae al valor por defecto, no deja el enlace sin host',
    async (valor) => {
      // `docker-compose.yml` inyecta `FRONTEND_URL: ${FRONTEND_URL}` y Compose
      // sustituye por cadena vacía cuando falta en el `.env`: no omite la clave.
      // Con `??` el enlace saldría como `/portal/tickets/13`, sin host.
      const { dispatcher, email } = montar({ frontendUrl: valor });

      await dispatcher.dispatchForEvent(unEvento());
      const [correo] = enviados(email);
      expect(correo.html).toContain(`http://localhost:5173/portal/tickets/${TICKET_ID}`);
      expect(correo.html).not.toContain(`"/portal/tickets/${TICKET_ID}"`);
    },
  );

  it('una razón social vacía en base sale como "(no disponible)", no como un hueco', async () => {
    const { dispatcher, email } = montar({ cliente: { id: CLIENT_ID, razonSocial: '' } });

    await dispatcher.dispatchForEvent(unEvento());
    const [correo] = enviados(email);
    expect(correo.html).toContain('(no disponible)');
    expect(correo.html).not.toContain('<strong>Empresa:</strong> </li>');
  });

  it('una URL con asteriscos no acaba con un <strong> dentro del href', async () => {
    const plantillaConUrlRara = {
      ...PLANTILLA_CLIENTE,
      bodyMd: 'Mira **aquí**: https://docs.kuboti.com/a**b**c/fin',
    };
    const { dispatcher, email } = montar({
      plantillas: [plantillaConUrlRara, PLANTILLA_EQUIPO_ALTA],
    });

    await dispatcher.dispatchForEvent(unEvento());
    const [correo] = enviados(email);
    const href = /href="([^"]*)"/.exec(correo.html)?.[1] ?? '';
    expect(href).not.toContain('<');
    // La negrita de fuera del enlace sí se sigue convirtiendo.
    expect(correo.html).toContain('<strong>aquí</strong>');
  });
});

// ---------------------------------------------------------------------------
// El juego de claves por público, fijado por un test y no solo por el tipo
// ---------------------------------------------------------------------------

describe('los juegos de valores', () => {
  /** Contexto mínimo: estas dos funciones son puras respecto a lo que reciben. */
  const contexto = {
    ticket: unTicket(),
    event: unEvento(),
    razonSocial: 'Comercial Andina SAC',
    responsable: RESPONSABLE_NOMBRE,
    frontendUrl: 'https://docs.kuboti.com',
  };

  it('el del cliente tiene exactamente las claves de su catálogo, ni una más', () => {
    const { dispatcher } = montar();
    const values = (dispatcher as any).clientValues(contexto);

    // Aflojar el tipo de retorno a Record<string, …> quitaría la única barrera
    // que hay hoy contra que una clave de equipo se cuele aquí sin que nada se
    // ponga en rojo. Esta aserción es esa segunda barrera.
    expect(Object.keys(values).sort()).toEqual([...CLIENT_VARIABLES].sort());
  });

  it('el del equipo tiene exactamente las claves del suyo', () => {
    const { dispatcher } = montar();
    const values = (dispatcher as any).teamValues(contexto);

    expect(Object.keys(values).sort()).toEqual([...TEAM_VARIABLES].sort());
  });
});
