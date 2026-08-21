import { judgeDeadline, judgeCommitment, compliancePercent } from './monthly-report';

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
