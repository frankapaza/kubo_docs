import { NotFoundException } from '@nestjs/common';

import {
  PortalReportsService,
  toReportTicketRow,
  toReportRequirementRow,
  toTicketView,
  toRequirementView,
} from './portal-reports.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { WorkItem } from '../work-items/entities/work-item.entity';
import { ReportRequirementRowWithCompliance, ReportTicketRowWithCompliance } from './domain/monthly-report';

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

/**
 * Ronda de correcciones 1: los dobles de más abajo (`ticketRows`,
 * `requirementRows`) construían el ticket/requerimiento con los campos
 * escogidos a mano — exactamente lo que hace inofensivo a un `{...t}`
 * accidental en `toReportTicketRow`/`toReportRequirementRow`, porque nunca
 * hay un campo interno que ese `{...t}` pudiera colar. `fullTicket` y
 * `fullWorkItem` construyen la entidad **completa**, con todos los campos
 * internos poblados con centinelas reconocibles, para que un `{...t}` real
 * sí tenga algo que filtrar y la prueba de más abajo pueda cazarlo.
 */
function fullTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    code: 'TK-0001',
    clientId: 7,
    projectId: null,
    systemId: null,
    meetingId: null,
    origin: 'PORTAL',
    requestType: 'INCIDENCIA',
    serviceCategory: 'SOPORTE',
    subject: 'Algo falla',
    rawText: 'SENTINEL_RAW_TEXT',
    rawAudioFilename: null,
    descriptionMd: 'Detalle del problema',
    acceptanceCriteria: null,
    labels: null,
    moduleName: null,
    screenName: null,
    flowContext: null,
    impact: null,
    urgency: null,
    priority: 'P3',
    priorityOverridden: 0,
    status: 'RESUELTO',
    assigneeUserId: 424242,
    escalationLevel: 'N2',
    slaPolicyId: 555555,
    slaResponseDueAt: new Date('2026-07-05T15:00:00Z'),
    slaResolutionDueAt: new Date('2026-07-06T14:00:00Z'),
    firstResponseAt: new Date('2026-07-05T14:30:00Z'),
    pausedAt: null,
    pausedTotalSeconds: 0,
    slaAtRisk: 0,
    capturedAt: new Date('2026-07-05T14:00:00Z'),
    attendedAt: new Date('2026-07-05T14:10:00Z'),
    resolvedAt: new Date('2026-07-05T18:00:00Z'),
    closedAt: null,
    resolutionMd: 'SENTINEL_RESOLUTION_MD',
    rootCause: 'SENTINEL_ROOT_CAUSE',
    correctiveAction: 'SENTINEL_CORRECTIVE_ACTION',
    scheduledAt: null,
    durationMinutes: 45,
    jiraIntegrationId: 3,
    jiraProjectKey: 'SENTINEL_JIRA_PROJECT',
    jiraIssueKey: 'SENTINEL_JIRA_ISSUE',
    jiraIssueUrl: 'SENTINEL_JIRA_URL',
    sentAt: null,
    closureDocumentId: null,
    createdBy: 111111,
    createdByClientUserId: null,
    createdAt: new Date('2026-07-05T14:00:00Z'),
    updatedAt: new Date('2026-07-05T18:00:00Z'),
    ...overrides,
  } as Ticket;
}

/** Los ocho campos internos que `toReportTicketRow` nunca debe dejar pasar. */
const TICKET_SENTINELS = [
  'SENTINEL_RAW_TEXT',
  'SENTINEL_RESOLUTION_MD',
  'SENTINEL_ROOT_CAUSE',
  'SENTINEL_CORRECTIVE_ACTION',
  'SENTINEL_JIRA_PROJECT',
  'SENTINEL_JIRA_ISSUE',
  'SENTINEL_JIRA_URL',
  '424242', // assigneeUserId
];

function fullWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 1,
    code: 'RQ-0001',
    clientId: 7,
    origin: 'PORTAL',
    projectId: 777777,
    title: 'Exportar a Excel',
    descriptionMd: 'SENTINEL_DESCRIPTION_MD',
    acceptanceCriteria: ['SENTINEL_ACCEPTANCE'],
    labels: ['SENTINEL_LABEL'],
    status: 'EN_PROCESO',
    priority: 'MEDIA',
    assigneeUserId: 888888,
    boardOrder: 999999,
    dueDate: null,
    closedAt: null,
    createdBy: 222222,
    createdByClientUserId: null,
    createdAt: new Date('2026-07-05T14:00:00Z'),
    updatedAt: new Date('2026-07-05T14:00:00Z'),
    ...overrides,
  } as WorkItem;
}

/** Los ocho campos internos que `toReportRequirementRow` nunca debe dejar pasar. */
const REQUIREMENT_SENTINELS = [
  'SENTINEL_DESCRIPTION_MD',
  'SENTINEL_ACCEPTANCE',
  'SENTINEL_LABEL',
  '888888', // assigneeUserId
  '999999', // boardOrder
  '777777', // projectId
  '222222', // createdBy
];

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

  /**
   * Ronda de correcciones 1: la prueba de arriba solo afirma que lanza, y
   * mover `assertSessionScope` **debajo** de las tres consultas deja esa
   * prueba en verde igual — devolvería el rechazo después de haber leído
   * datos de quién sabe qué empresa. Mismo patrón que
   * `portal-tickets.service.spec.ts` (`describe('la frontera')`): un
   * `it.each` sobre los valores que de verdad hacen desaparecer un `WHERE`
   * —`0`, `undefined`, `null`, `NaN`, negativo, decimal— más la afirmación de
   * que ningún repositorio llegó a consultarse.
   */
  it.each([
    ['cero', 0],
    ['indefinido', undefined],
    ['nulo', null],
    ['NaN', NaN],
    ['negativo', -1],
    ['decimal', 1.5],
  ])('rechaza un clientId %s sin llegar a consultar ningun repositorio', async (_etiqueta, valor) => {
    const { service, ticketsRepo, workItemsRepo, clients } = make({});
    await expect(service.monthly(valor as any, { year: 2026, month: 7, scope: 'AMBOS' })).rejects.toThrow();
    expect(ticketsRepo.listForClientPeriod).not.toHaveBeenCalled();
    expect(ticketsRepo.countResolvedInPeriod).not.toHaveBeenCalled();
    expect(workItemsRepo.listPortalRequirementsInPeriod).not.toHaveBeenCalled();
    expect(clients.findByIdOrFail).not.toHaveBeenCalled();
  });

  // Mismo motivo que arriba, para el otro guardián de entrada: nada impide
  // hoy que se consulte la base antes de rechazar un mes que todavía no
  // cerró, y esta prueba lo fija.
  it('rechaza el mes en curso sin llegar a consultar ningun repositorio', async () => {
    const { service, ticketsRepo, workItemsRepo, clients } = make({ ahora: new Date('2026-08-07T12:00:00Z') });
    await expect(service.monthly(7, { year: 2026, month: 8, scope: 'AMBOS' })).rejects.toThrow();
    expect(ticketsRepo.listForClientPeriod).not.toHaveBeenCalled();
    expect(ticketsRepo.countResolvedInPeriod).not.toHaveBeenCalled();
    expect(workItemsRepo.listPortalRequirementsInPeriod).not.toHaveBeenCalled();
    expect(clients.findByIdOrFail).not.toHaveBeenCalled();
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

  /**
   * Ronda de correcciones 1: `generatedAt` en ISO no dice ni la hora de Perú
   * ni lleva la zona escrita, y quien lo formatee después (el navegador del
   * cliente) no es fiable — de una veintena de formateadores del frontend,
   * el revisor encontró que solo uno pasa `timeZone`. El backend, que corre
   * con `TZ=UTC` fijo, es la única capa donde esto se puede cazar con una
   * prueba.
   */
  it('generatedAtLabel lleva fecha y hora en español, en hora de Peru y con la zona escrita', async () => {
    const { service } = make({ ahora: new Date('2026-08-22T00:42:00Z') }); // 21 ago, 7:42 p.m. en Lima
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'TICKETS' });
    expect(v.generatedAtLabel).toBe('21 de agosto de 2026 a las 7:42 p. m. (hora de Perú)');
  });

  /**
   * Ronda de correcciones 1 (tarea 7): el frontend pintaba estas marcas de
   * tiempo con `fmtDate` -- sin hora y sin zona. En un informe cuyo
   * propósito es evidenciar cumplimiento de SLA, un veredicto
   * («Incumplido») que no se puede verificar contra la hora del vencimiento
   * impresa en el propio documento no prueba nada. Mismo remedio que
   * `generatedAtLabel`: la etiqueta se calcula aquí, en el backend que corre
   * con `TZ=UTC` fijo, no en el navegador de quien lo lee.
   *
   * `slaResponseDueAt` cae de madrugada en UTC (06 jul, 01:00Z) pero de
   * noche del día anterior en Lima (05 jul, 8:00 p.m.): si la etiqueta
   * saliera sin `timeZone: PERU_TIME_ZONE`, esta prueba la cazaría con la
   * fecha corrida un día, el mismo desplazamiento que ya mordió tres veces
   * a este proyecto.
   */
  it('las marcas de tiempo del ticket llevan su etiqueta en hora de Peru, y null cuando el instante no existe', async () => {
    const { service } = make({
      ticketRows: [
        {
          id: 1,
          code: 'TK-0001',
          subject: 'Algo falla',
          serviceCategory: 'SOPORTE',
          priority: 'P3',
          status: 'ASIGNADO',
          capturedAt: new Date('2026-07-05T14:00:00Z'),
          firstResponseAt: null,
          resolvedAt: null,
          slaResponseDueAt: new Date('2026-07-06T01:00:00Z'), // 5 jul, 8:00 p.m. en Lima
          slaResolutionDueAt: null,
        } as Partial<Ticket>,
      ],
    });
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'TICKETS' });
    const fila = v.tickets!.rows[0];
    expect(fila.slaResponseDueAtLabel).toBe('5 de julio de 2026 a las 8:00 p. m. (hora de Perú)');
    // `null` entra, `null` sale: sin instante no hay etiqueta que inventar.
    expect(fila.firstResponseAtLabel).toBeNull();
    expect(fila.resolvedAtLabel).toBeNull();
    expect(fila.slaResolutionDueAtLabel).toBeNull();
  });

  /**
   * Ronda de correcciones 1: dos expresiones regulares sueltas sobreviven a
   * mutaciones reales del texto — formatear `hasta` con `to` en vez de
   * `to - 1ms` (el documento diría cubrir «hasta el 1 de agosto», un día que
   * no cubre), intercambiar `desde`/`hasta`, o borrar la frase de «resueltos
   * dentro del periodo». Fijar el texto completo para un mes conocido mata
   * las tres, y de propina mata también quitar la zona de `formatPeruDate`.
   */
  it('el criterio para AMBOS en julio de 2026 es exactamente este texto', async () => {
    const { service } = make({});
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'AMBOS' });
    expect(v.criteria).toBe(
      'Tickets y requerimientos creados entre el 1 de julio de 2026 y el 31 de julio de 2026, hora de Perú. ' +
        '«Resueltos dentro del periodo» cuenta los resueltos en esas fechas, se hayan creado cuando fuera. ' +
        'Solo se listan los requerimientos que la empresa registró desde este portal; los que gestiona el ' +
        'equipo internamente no aparecen aquí. Los totales y el estado de cada fila reflejan la situación ' +
        'actual, no una foto fija del cierre del periodo: dos descargas de este mismo mes pueden mostrar ' +
        'cifras distintas si algo cambió después. Por el mismo motivo, los veredictos de cumplimiento de ' +
        'plazos reflejan el estado actual de cada ticket o requerimiento, no el que tenía al cerrar el periodo.',
    );
  });

  // No solo el veredicto de cumplimiento se mueve entre dos descargas: los
  // totales (`resolved`, `pending`) y el estado de cada fila tambien, porque
  // cuentan la situacion de hoy. El cliente que compara dos PDF ve primero
  // «Resueltos: 3» contra «Resueltos: 5», antes que ningun veredicto.
  it('el criterio dice que los totales y el estado de cada fila tambien reflejan la situacion actual', async () => {
    const { service } = make({});
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'AMBOS' });
    expect(v.criteria).toMatch(/totales.*estado de cada fila.*situaci[oó]n actual/i);
  });

  // El filtro `origin: 'PORTAL'` es real: un requerimiento que la casa
  // registro internamente no sale aqui, sea de esta empresa y de este
  // periodo o no. Sin esta frase, un cliente cuyos requerimientos gestiona
  // la casa por otra via ve un bloque vacio sin que nada se lo explique — y
  // con los doce requerimientos de produccion, hoy todos internos, ese
  // bloque va a salir vacio de verdad.
  it('el criterio para REQUERIMIENTOS avisa que solo salen los pedidos desde el portal', async () => {
    const { service } = make({});
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'REQUERIMIENTOS' });
    expect(v.criteria).toMatch(/portal/i);
    expect(v.criteria).not.toMatch(/tickets/i);
  });

  it('el criterio para TICKETS no menciona requerimientos ni el filtro de origen', async () => {
    const { service } = make({});
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'TICKETS' });
    expect(v.criteria).not.toMatch(/requerimientos/i);
    expect(v.criteria).toMatch(/resueltos dentro del periodo/i);
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

  /**
   * Ronda de correcciones 1: con dobles de tickets escogidos a mano (como los
   * de arriba), el mutante `toReportTicketRow = (t) => ({ ...t })` pasa igual
   * de verde — nunca hay un campo interno presente que ese `{...t}` pudiera
   * filtrar. `fullTicket()` sí lo pobla, con un ticket **completo** y ocho
   * centinelas en sus columnas internas.
   *
   * También comprobado, y por qué la prueba llega hasta aquí: probar solo la
   * salida de `service.monthly(...)` de punta a punta **no basta**. Hay dos
   * capas de lista blanca en el camino (`toReportTicketRow` y `toTicketView`)
   * y, mientras las dos existan, mutar cualquiera de ellas por separado a un
   * `{...spread}` sigue sin filtrar nada — la otra capa lo vuelve a limpiar.
   * Lo verifiqué mutando cada una por turnos y viendo la prueba de punta a
   * punta seguir en verde. Por eso las dos funciones se prueban aquí de forma
   * **directa y aislada**: solo así un mutante en cualquiera de las dos capas
   * queda descubierto sin depender de que la otra siga intacta.
   */
  it('toReportTicketRow nunca deja pasar un campo interno del ticket', () => {
    const fila = toReportTicketRow(fullTicket());
    const serializado = JSON.stringify(fila);
    for (const centinela of TICKET_SENTINELS) {
      expect(serializado).not.toContain(centinela);
    }
  });

  it('toTicketView nunca deja pasar un campo que no esté en su lista blanca', () => {
    // Simula una fila que ya llegara "sucia" desde río arriba: si
    // `toTicketView` hiciera `{...r}`, estos centinelas reaparecerían en la
    // salida aunque `toReportTicketRow` los hubiera limpiado bien.
    const filaSucia = {
      id: 1, code: 'TK-0001', subject: 'Algo falla', category: 'SOPORTE',
      priority: 'P3', status: 'RESUELTO',
      capturedAt: new Date('2026-07-05T14:00:00Z'), firstResponseAt: null,
      resolvedAt: new Date('2026-07-05T18:00:00Z'),
      slaResponseDueAt: null, slaResolutionDueAt: null,
      responseCompliance: 'CUMPLIDO', resolutionCompliance: 'CUMPLIDO',
      rootCause: 'SENTINEL_ROOT_CAUSE', resolutionMd: 'SENTINEL_RESOLUTION_MD',
      assigneeUserId: 424242, slaPolicyId: 555555,
    } as unknown as ReportTicketRowWithCompliance;

    const vista = toTicketView(filaSucia);
    const serializado = JSON.stringify(vista);
    for (const centinela of ['SENTINEL_ROOT_CAUSE', 'SENTINEL_RESOLUTION_MD', '424242', '555555']) {
      expect(serializado).not.toContain(centinela);
    }
  });

  /** Misma disciplina que las dos pruebas de tickets, para el otro bloque. */
  it('toReportRequirementRow nunca deja pasar un campo interno del requerimiento', () => {
    const fila = toReportRequirementRow(fullWorkItem());
    const serializado = JSON.stringify(fila);
    for (const centinela of REQUIREMENT_SENTINELS) {
      expect(serializado).not.toContain(centinela);
    }
  });

  it('toRequirementView nunca deja pasar un campo que no esté en su lista blanca', () => {
    const filaSucia = {
      id: 1, code: 'RQ-0001', title: 'Exportar a Excel', status: 'EN_PROCESO',
      createdAt: new Date('2026-07-05T14:00:00Z'), dueDate: null, closedAt: null,
      commitment: 'SIN_COMPROMISO',
      labels: ['SENTINEL_LABEL'], boardOrder: 999999, assigneeUserId: 888888,
    } as unknown as ReportRequirementRowWithCompliance;

    const vista = toRequirementView(filaSucia);
    const serializado = JSON.stringify(vista);
    for (const centinela of ['SENTINEL_LABEL', '999999', '888888']) {
      expect(serializado).not.toContain(centinela);
    }
  });

  /**
   * Y la comprobación de extremo a extremo, con la doble capa intacta: sigue
   * teniendo valor como regresión del comportamiento que de verdad se
   * publica, aunque —a diferencia de las cuatro pruebas de arriba— no aísle
   * en qué capa fallaría un mutante.
   */
  it('de punta a punta, ningun campo interno del ticket ni del requerimiento llega a la vista', async () => {
    const { service } = make({ ticketRows: [fullTicket()], requirementRows: [fullWorkItem()] });
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'AMBOS' });

    const serializado = JSON.stringify([v.tickets!.rows[0], v.requirements!.rows[0]]);
    for (const centinela of [...TICKET_SENTINELS, ...REQUIREMENT_SENTINELS]) {
      expect(serializado).not.toContain(centinela);
    }
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
