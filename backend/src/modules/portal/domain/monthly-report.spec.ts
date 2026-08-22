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
});

describe('judgeCommitment', () => {
  it('entregado antes de la fecha comprometida es CUMPLIDO', () => {
    expect(judgeCommitment('2026-08-20', new Date('2026-08-18T15:00:00Z'), FIN)).toBe('CUMPLIDO');
  });

  // Se compara por fecha civil, no por instante: la fecha comprometida es un
  // dia entero, no un momento. Entregar a las 22:00 de ese dia cumple.
  it('entregado el mismo dia comprometido es CUMPLIDO, a cualquier hora', () => {
    expect(judgeCommitment('2026-08-20', new Date('2026-08-21T02:00:00Z'), FIN)).toBe('CUMPLIDO');
  });

  it('entregado al dia siguiente es INCUMPLIDO', () => {
    expect(judgeCommitment('2026-08-20', new Date('2026-08-22T02:00:00Z'), FIN)).toBe('INCUMPLIDO');
  });

  it('sin entregar y con la fecha ya pasada es INCUMPLIDO', () => {
    expect(judgeCommitment('2026-08-20', null, FIN)).toBe('INCUMPLIDO');
  });

  it('sin fecha comprometida es SIN_COMPROMISO', () => {
    expect(judgeCommitment(null, null, FIN)).toBe('SIN_COMPROMISO');
    expect(judgeCommitment(null, new Date('2026-08-18T15:00:00Z'), FIN)).toBe('SIN_COMPROMISO');
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

  it('los tickets sin SLA no bajan el porcentaje', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [
        ticket({ id: 1 }),                                            // cumple los dos
        ticket({ id: 2, slaResponseDueAt: null, slaResolutionDueAt: null }),
      ],
      ticketsResolvedInPeriod: 2, requirements: null,
    });
    expect(r.tickets!.totals.responseCompliancePercent).toBe(100);
    expect(r.tickets!.totals.resolutionCompliancePercent).toBe(100);
    expect(r.tickets!.totals.withoutCommitment).toBe(1);
  });

  it('un periodo vacio da ceros y porcentajes nulos, nunca NaN', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [], ticketsResolvedInPeriod: 0, requirements: [],
    });
    expect(r.tickets!.totals.received).toBe(0);
    expect(r.tickets!.totals.responseCompliancePercent).toBeNull();
    expect(r.requirements!.totals.commitmentCompliancePercent).toBeNull();
    expect(Number.isNaN(r.tickets!.totals.responseCompliancePercent as number)).toBe(false);
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
      ],
    });
    expect(r.requirements!.totals.requested).toBe(4);
    expect(r.requirements!.totals.accepted).toBe(2);   // PENDIENTE y CERRADO
    expect(r.requirements!.totals.delivered).toBe(1);
    expect(r.requirements!.totals.rejected).toBe(1);
    expect(r.requirements!.totals.commitmentCompliancePercent).toBe(100); // solo el entregado mide
  });
});
