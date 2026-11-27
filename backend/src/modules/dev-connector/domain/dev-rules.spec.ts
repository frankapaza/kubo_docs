import { canAgentTransition, matchStaff, normalizeCode, priorityRank, transitionNeedsReason } from './dev-rules';

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
    ['KB', 'EN_ATENCION', 'ESPERA_CLIENTE'],
    ['KB', 'EN_ATENCION', 'DERIVADO'],
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
    // A Pruebas solo con evidencia y manual: entregar_requerimiento.
    ['RQ', 'EN_PROCESO', 'PRUEBAS'],
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

describe('transitionNeedsReason', () => {
  it('pasar a Espera del cliente o Derivado exige motivo; volver a En atención no', () => {
    expect(transitionNeedsReason('ESPERA_CLIENTE')).toBe(true);
    expect(transitionNeedsReason('DERIVADO')).toBe(true);
    expect(transitionNeedsReason('EN_ATENCION')).toBe(false);
  });
});

describe('matchStaff', () => {
  const staff = [
    { id: 1, email: 'ana.perez@kubo.pe', fullName: 'Ana Pérez' },
    { id: 2, email: 'ana.ruiz@kubo.pe', fullName: 'Ana Ruiz' },
    { id: 3, email: 'luis@kubo.pe', fullName: 'Luis Gómez' },
  ];
  it('por correo exacto, sin importar mayúsculas', () => {
    expect(matchStaff(staff, ' Luis@Kubo.pe ')).toEqual({ ok: true, user: staff[2] });
  });
  it('por nombre, sin tildes ni mayúsculas, si es único', () => {
    expect(matchStaff(staff, 'gomez')).toEqual({ ok: true, user: staff[2] });
    expect(matchStaff(staff, 'ana perez')).toEqual({ ok: true, user: staff[0] });
  });
  it('ambiguo o inexistente -> no ok con candidatos', () => {
    expect(matchStaff(staff, 'ana')).toEqual({ ok: false, reason: 'AMBIGUO', candidatos: [staff[0], staff[1]] });
    expect(matchStaff(staff, 'pedro')).toEqual({ ok: false, reason: 'NO_EXISTE', candidatos: staff });
    expect(matchStaff(staff, '  ')).toEqual({ ok: false, reason: 'NO_EXISTE', candidatos: staff });
  });
});
