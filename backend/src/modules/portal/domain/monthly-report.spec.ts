import {
  judgeDeadline,
  judgeCommitment,
  compliancePercent,
  buildMonthlyReport,
  ReportTicketRow,
} from './monthly-report';

const INICIO = new Date('2026-08-01T05:00:00Z');
const FIN = new Date('2026-09-01T05:00:00Z'); // fin de agosto en hora de Perú

describe('judgeDeadline', () => {
  it('hecho antes del plazo es CUMPLIDO', () => {
    expect(judgeDeadline(new Date('2026-08-10T12:00:00Z'), new Date('2026-08-10T11:00:00Z'), FIN))
      .toBe('CUMPLIDO');
  });

  it('hecho justo en el plazo es CUMPLIDO: el limite es inclusivo', () => {
    const t = new Date('2026-08-10T12:00:00Z');
    expect(judgeDeadline(t, t, FIN)).toBe('CUMPLIDO');
  });

  it('hecho despues del plazo es INCUMPLIDO', () => {
    expect(judgeDeadline(new Date('2026-08-10T12:00:00Z'), new Date('2026-08-10T13:00:00Z'), FIN))
      .toBe('INCUMPLIDO');
  });

  it('sin hacer y con el plazo vencido dentro del periodo es INCUMPLIDO', () => {
    expect(judgeDeadline(new Date('2026-08-10T12:00:00Z'), null, FIN)).toBe('INCUMPLIDO');
  });

  // El corazon de este modulo. Sin plazo no hubo promesa: contarlo como
  // incumplido acusaria de romper algo que nunca se prometio, y como cumplido
  // inflaria el porcentaje con casos que nadie midio.
  it('sin plazo es SIN_COMPROMISO, este hecho o no', () => {
    expect(judgeDeadline(null, null, FIN)).toBe('SIN_COMPROMISO');
    expect(judgeDeadline(null, new Date('2026-08-10T12:00:00Z'), FIN)).toBe('SIN_COMPROMISO');
  });

  // El otro filo del mismo corazon: un plazo que SI existe pero que todavia
  // no vencia al cerrar el periodo tampoco es incumplido -- nadie rompio
  // nada todavia. Un ticket abierto el 31 de agosto con SLA a cinco dias no
  // vencio dentro de agosto. Sin esta prueba, colapsar la ultima linea de
  // `judgeDeadline` en `return 'INCUMPLIDO'` pasa la suite entera.
  it('con plazo aun no vencido al cierre del periodo y sin hacer es SIN_COMPROMISO', () => {
    const plazoPosteriorAlCierre = new Date('2026-09-03T12:00:00Z');
    expect(judgeDeadline(plazoPosteriorAlCierre, null, FIN)).toBe('SIN_COMPROMISO');
  });

  it('el limite exacto del periodo tambien es SIN_COMPROMISO: aun no vencio', () => {
    expect(judgeDeadline(FIN, null, FIN)).toBe('SIN_COMPROMISO');
  });
});

describe('judgeCommitment', () => {
  it('entregado antes de la fecha comprometida es CUMPLIDO', () => {
    expect(judgeCommitment('2026-08-20', new Date('2026-08-18T15:00:00Z'), FIN, 'CERRADO')).toBe('CUMPLIDO');
  });

  // Se compara por fecha civil, no por instante: la fecha comprometida es un
  // dia entero, no un momento. Entregar a las 22:00 de ese dia cumple.
  it('entregado el mismo dia comprometido es CUMPLIDO, a cualquier hora', () => {
    expect(judgeCommitment('2026-08-20', new Date('2026-08-21T02:00:00Z'), FIN, 'CERRADO')).toBe('CUMPLIDO');
  });

  it('entregado al dia siguiente es INCUMPLIDO', () => {
    expect(judgeCommitment('2026-08-20', new Date('2026-08-22T02:00:00Z'), FIN, 'CERRADO')).toBe('INCUMPLIDO');
  });

  it('sin entregar y con la fecha ya pasada es INCUMPLIDO', () => {
    expect(judgeCommitment('2026-08-20', null, FIN, 'PENDIENTE')).toBe('INCUMPLIDO');
  });

  it('sin fecha comprometida es SIN_COMPROMISO', () => {
    expect(judgeCommitment(null, null, FIN, 'PENDIENTE')).toBe('SIN_COMPROMISO');
    expect(judgeCommitment(null, new Date('2026-08-18T15:00:00Z'), FIN, 'CERRADO')).toBe('SIN_COMPROMISO');
  });

  // `periodEnd` es exclusivo (ver JSDoc de `judgeCommitment`): el dia civil
  // de `periodEnd` en si mismo queda fuera del periodo. Si se comparara con
  // un periodEnd inclusivo, el incumplimiento del ultimo dia del mes
  // desapareceria del informe -- justo lo que esta prueba fija.
  it('la fecha comprometida igual al dia civil de periodEnd (exclusivo) es SIN_COMPROMISO', () => {
    expect(judgeCommitment('2026-09-01', null, FIN, 'PENDIENTE')).toBe('SIN_COMPROMISO');
  });

  // Cadena vacia no es ausencia: es un valor invalido, pero tratarlo como
  // "no hubo promesa" por una comprobacion de veracidad (`!committedDate`)
  // repetiria el bug de los textos en blanco que ya mordio este proyecto.
  it('una fecha comprometida vacia no se trata como ausencia de compromiso', () => {
    expect(judgeCommitment('', null, FIN, 'PENDIENTE')).toBe('INCUMPLIDO');
  });

  // El corazon de la correccion de la revision final: `WorkItemsRepository.list`
  // ya documenta y hace cumplir que "un item CERRADO o CANCELADO nunca esta
  // vencido [...] su fecha limite dejo de significar nada". Antes de esta
  // prueba, un CANCELADO con fecha comprometida pasada y sin `closedAt`
  // (CANCELADO nunca lo tiene -- solo `to === 'CERRADO'` lo fija, ver
  // `WorkItemBoardService.move`) caia en la ultima rama y salia INCUMPLIDO:
  // la misma fila que el tablero pinta en gris, sin marca de vencido, el
  // informe la publicaba como incumplimiento del proveedor.
  it('un CANCELADO con fecha comprometida ya pasada y sin entregar es SIN_COMPROMISO, no INCUMPLIDO', () => {
    expect(judgeCommitment('2026-08-01', null, FIN, 'CANCELADO')).toBe('SIN_COMPROMISO');
  });

  // Un CANCELADO cuya fecha comprometida ni siquiera habia llegado tambien
  // es SIN_COMPROMISO -- mismo resultado que sin el caso especial, pero por
  // las dos vias a la vez, para que quede claro que no se solapan mal.
  it('un CANCELADO con fecha comprometida futura tambien es SIN_COMPROMISO', () => {
    expect(judgeCommitment('2026-09-15', null, FIN, 'CANCELADO')).toBe('SIN_COMPROMISO');
  });
});

describe('compliancePercent', () => {
  // La regla que hace honesto el numero: los sin compromiso no cuentan abajo.
  it('excluye los SIN_COMPROMISO del denominador', () => {
    expect(compliancePercent(['CUMPLIDO', 'INCUMPLIDO', 'SIN_COMPROMISO', 'SIN_COMPROMISO']))
      .toBe(50);
  });

  it('redondea a entero', () => {
    expect(compliancePercent(['CUMPLIDO', 'CUMPLIDO', 'INCUMPLIDO'])).toBe(67);
  });

  // Dividir entre cero es el error mas probable de este calculo, y un NaN en
  // un PDF que ve un cliente es peor que un hueco.
  it('devuelve null si no hubo ningun compromiso que medir', () => {
    expect(compliancePercent([])).toBeNull();
    expect(compliancePercent(['SIN_COMPROMISO', 'SIN_COMPROMISO'])).toBeNull();
  });
});

function ticket(p: Partial<ReportTicketRow> = {}): ReportTicketRow {
  return {
    id: 1, code: 'TK-0001', subject: 'Algo falla', category: 'SOPORTE',
    priority: 'P3', status: 'RESUELTO',
    capturedAt: new Date('2026-08-05T14:00:00Z'),
    firstResponseAt: new Date('2026-08-05T14:30:00Z'),
    resolvedAt: new Date('2026-08-05T18:00:00Z'),
    slaResponseDueAt: new Date('2026-08-05T15:00:00Z'),
    slaResolutionDueAt: new Date('2026-08-06T14:00:00Z'),
    ...p,
  };
}

describe('buildMonthlyReport', () => {
  it('un bloque no pedido queda en null, no en un bloque vacio', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [ticket()], ticketsResolvedInPeriod: 1, requirements: null,
    });
    expect(r.requirements).toBeNull();
    expect(r.tickets).not.toBeNull();
  });

  it('cuenta recibidos, resueltos y pendientes de los del periodo', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [
        ticket({ id: 1, status: 'RESUELTO' }),
        ticket({ id: 2, status: 'CERRADO' }),
        ticket({ id: 3, status: 'EN_ATENCION', resolvedAt: null }),
      ],
      ticketsResolvedInPeriod: 5, requirements: null,
    });
    expect(r.tickets!.totals.received).toBe(3);
    expect(r.tickets!.totals.resolved).toBe(2);
    expect(r.tickets!.totals.pending).toBe(1);
  });

  // La cifra que mas confunde a quien lee el documento, y por eso lleva su
  // propio criterio impreso: son conjuntos distintos, no la misma cuenta.
  it('«resueltos dentro del periodo» es una cifra aparte de «resueltos»', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [ticket({ id: 1 })], ticketsResolvedInPeriod: 7, requirements: null,
    });
    expect(r.tickets!.totals.resolved).toBe(1);
    expect(r.tickets!.totals.resolvedInPeriod).toBe(7);
  });

  it('los tickets sin SLA de resolucion no bajan el porcentaje', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [
        ticket({ id: 1 }),                              // cumple los dos
        ticket({ id: 2, slaResolutionDueAt: null }),     // solo sin SLA de resolucion
      ],
      ticketsResolvedInPeriod: 2, requirements: null,
    });
    expect(r.tickets!.totals.responseCompliancePercent).toBe(100);
    expect(r.tickets!.totals.resolutionCompliancePercent).toBe(100);
    expect(r.tickets!.totals.withoutCommitment).toBe(1);
  });

  // `withoutCommitment` mezclaba antes dos causas distintas del mismo
  // veredicto SIN_COMPROMISO: "nunca hubo SLA" y "el SLA aun no vencia al
  // cierre". Confundirlas le haria decir al PDF que un ticket con un SLA
  // vigente "no tuvo compromiso", cuando si lo tiene -- solo que todavia no
  // vencio. Esta prueba fija que son contadores separados.
  it('distingue "nunca hubo SLA" de "el SLA aun no vencia": son causas distintas', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [
        ticket({ id: 1, slaResolutionDueAt: null }),                     // nunca hubo SLA de resolucion
        ticket({
          id: 2, status: 'EN_ATENCION', resolvedAt: null,
          slaResolutionDueAt: new Date('2026-09-05T12:00:00Z'),          // SLA vigente, aun no vence
        }),
        ticket({ id: 3 }),                                               // SLA ya juzgado (CUMPLIDO)
      ],
      ticketsResolvedInPeriod: 2, requirements: null,
    });
    expect(r.tickets!.totals.withoutCommitment).toBe(1);
    // El universo de `notYetDue` son las filas SIN_COMPROMISO con plazo
    // pactado, no cualquier fila con `slaResolutionDueAt`. El ticket 3 ya
    // tiene veredicto (CUMPLIDO) y también tiene un plazo pactado: si se
    // contara por "tiene slaResolutionDueAt" en lugar de por "está entre las
    // SIN_COMPROMISO", colaría aquí también y el conteo daría 2, no 1.
    expect(r.tickets!.totals.notYetDue).toBe(1);
  });

  // Mismo defecto, mismo remedio, pero del lado del SLA de respuesta: antes
  // de esta correccion el documento decia "Cumplimiento de respuesta: 100 %"
  // sin decir sobre cuantos se calculo -- exactamente lo que la revision
  // final senalo como faltante.
  it('separa "nunca hubo SLA de respuesta" de "el SLA de respuesta aun no vencia"', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [
        ticket({ id: 1, slaResponseDueAt: null }),                        // nunca hubo SLA de respuesta
        ticket({
          id: 2, status: 'NUEVO', firstResponseAt: null, resolvedAt: null,
          slaResponseDueAt: new Date('2026-09-05T12:00:00Z'),             // SLA vigente, aun no vence
          slaResolutionDueAt: null,
        }),
        ticket({ id: 3 }),                                                // SLA de respuesta ya juzgado (CUMPLIDO)
      ],
      ticketsResolvedInPeriod: 1, requirements: null,
    });
    expect(r.tickets!.totals.responseWithoutCommitment).toBe(1);
    expect(r.tickets!.totals.responseNotYetDue).toBe(1);
  });

  it('un periodo vacio da ceros y porcentajes nulos', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [], ticketsResolvedInPeriod: 0, requirements: [],
    });
    expect(r.tickets!.totals.received).toBe(0);
    expect(r.tickets!.totals.responseCompliancePercent).toBeNull();
    expect(r.requirements!.totals.commitmentCompliancePercent).toBeNull();
  });

  // La proteccion real contra el NaN no esta en un bloque sin filas (ese
  // caso ya lo cubre `compliancePercent([])` directamente): esta en un
  // bloque CON filas donde ninguna es medible. Si `compliancePercent`
  // dividiera por `rows.length` en lugar de por los medibles, esta prueba
  // rompe con NaN en vez de con null.
  it('un bloque con filas pero sin ningun compromiso medible da null, nunca NaN', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [ticket({ slaResponseDueAt: null, slaResolutionDueAt: null })],
      ticketsResolvedInPeriod: 0, requirements: null,
    });
    expect(r.tickets!.totals.responseCompliancePercent).toBeNull();
    expect(r.tickets!.totals.resolutionCompliancePercent).toBeNull();
    expect(Number.isNaN(r.tickets!.totals.responseCompliancePercent)).toBe(false);
  });

  it('cuenta los requerimientos por estado', () => {
    const base = { createdAt: new Date('2026-08-03T12:00:00Z'), dueDate: null, closedAt: null };
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN, tickets: null, ticketsResolvedInPeriod: null,
      requirements: [
        { id: 1, code: 'RQ-0001', title: 'a', status: 'SOLICITADO', ...base },
        { id: 2, code: 'RQ-0002', title: 'b', status: 'PENDIENTE', ...base, dueDate: '2026-09-30' },
        { id: 3, code: 'RQ-0003', title: 'c', status: 'CERRADO', ...base,
          dueDate: '2026-08-20', closedAt: new Date('2026-08-19T12:00:00Z') },
        { id: 4, code: 'RQ-0004', title: 'd', status: 'RECHAZADO', ...base },
        // Estado que no existe en el catalogo de hoy. Si "accepted" se
        // decidiera por lista negra, esta fila colaria como aceptada solo
        // por no estar prohibida. Con lista blanca no cuenta, y esta fila
        // fija esa eleccion.
        { id: 5, code: 'RQ-0005', title: 'e', status: 'ANULADO', ...base },
      ],
    });
    expect(r.requirements!.totals.requested).toBe(5);
    expect(r.requirements!.totals.accepted).toBe(2);   // PENDIENTE y CERRADO
    expect(r.requirements!.totals.delivered).toBe(1);
    expect(r.requirements!.totals.rejected).toBe(1);
    expect(r.requirements!.totals.commitmentCompliancePercent).toBe(100); // solo el entregado mide
    // Los tres sin `dueDate` (1 SOLICITADO, 4 RECHAZADO, 5 ANULADO) son
    // "nunca hubo compromiso"; el 2 (PENDIENTE, comprometido para el 30 de
    // setiembre, fuera del periodo de agosto) es "aun no vencia": la misma
    // distincion que ya tenian los tickets, ahora con su propio contador
    // para requerimientos. El 3 (CERRADO) ya tiene veredicto CUMPLIDO y no
    // entra en ninguno de los dos.
    expect(r.requirements!.totals.withoutCommitment).toBe(3);
    expect(r.requirements!.totals.notYetDue).toBe(1);
  });

  // Integracion de la correccion de la revision final: un CANCELADO con
  // fecha comprometida ya pasada no debe bajar el porcentaje de
  // cumplimiento ni contar como "vencido" -- ver `judgeCommitment` y su
  // JSDoc. Sigue contando en "Aceptados" porque paso por la aceptacion
  // antes de cancelarse (ver JSDoc de `RequirementsTotals.accepted`).
  it('un CANCELADO con fecha pasada no baja el porcentaje y sigue contando en Aceptados', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN, tickets: null, ticketsResolvedInPeriod: null,
      requirements: [
        {
          id: 1, code: 'RQ-0001', title: 'Cancelado con fecha vencida', status: 'CANCELADO',
          createdAt: new Date('2026-08-03T12:00:00Z'), dueDate: '2026-08-10', closedAt: null,
        },
        {
          id: 2, code: 'RQ-0002', title: 'Entregado a tiempo', status: 'CERRADO',
          createdAt: new Date('2026-08-01T12:00:00Z'), dueDate: '2026-08-20',
          closedAt: new Date('2026-08-19T12:00:00Z'),
        },
      ],
    });
    expect(r.requirements!.rows[0].commitment).toBe('SIN_COMPROMISO');
    expect(r.requirements!.totals.accepted).toBe(2);
    // Si el CANCELADO contara como INCUMPLIDO, este porcentaje seria 50, no
    // 100: la correccion existe para que el unico veredicto medible sea el
    // del entregado.
    expect(r.requirements!.totals.commitmentCompliancePercent).toBe(100);
    expect(r.requirements!.totals.notYetDue).toBe(1);
  });
});
