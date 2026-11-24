import { canAgentTransition, normalizeCode, priorityRank } from './dev-rules';

describe('normalizeCode', () => {
  it('normaliza el código', () => {
    expect(normalizeCode(' kb-0210 ')).toEqual({ kind: 'KB', code: 'KB-0210' });
    expect(normalizeCode('RQ-0045')).toEqual({ kind: 'RQ', code: 'RQ-0045' });
    expect(normalizeCode('rq-12345')).toEqual({ kind: 'RQ', code: 'RQ-12345' });
  });

  it('rechaza lo que no es un código', () => {
    expect(normalizeCode('KB-12')).toBeNull();
    expect(normalizeCode('XX-0001')).toBeNull();
    expect(normalizeCode('KB-0001; DROP')).toBeNull();
    expect(normalizeCode('')).toBeNull();
  });
});

describe('canAgentTransition', () => {
  it.each([
    ['KB', 'ASIGNADO', 'EN_ATENCION'],
    ['KB', 'ESPERA_CLIENTE', 'EN_ATENCION'],
    ['RQ', 'PENDIENTE', 'EN_PROCESO'],
    ['RQ', 'EN_PROCESO', 'PRUEBAS'],
  ] as const)('%s %s → %s permitido', (kind, from, to) => {
    expect(canAgentTransition(kind, from, to)).toBe(true);
  });

  it.each([
    ['KB', 'EN_ATENCION', 'RESUELTO'],
    ['KB', 'EN_ATENCION', 'CERRADO'],
    ['KB', 'NUEVO', 'EN_ATENCION'],
    ['RQ', 'PRUEBAS', 'CERRADO'],
    ['RQ', 'SOLICITADO', 'EN_PROCESO'],
    ['RQ', 'PENDIENTE', 'PRUEBAS'],
  ] as const)('%s %s → %s prohibido', (kind, from, to) => {
    expect(canAgentTransition(kind, from, to)).toBe(false);
  });
});

describe('priorityRank', () => {
  it('ordena P1 antes que ALTA y ALTA antes que P3', () => {
    expect(priorityRank('P1')).toBeLessThan(priorityRank('ALTA'));
    expect(priorityRank('ALTA')).toBeLessThan(priorityRank('P3'));
    expect(priorityRank('MEDIA')).toBe(priorityRank('P3'));
    expect(priorityRank('BAJA')).toBe(priorityRank('P4'));
  });
});
