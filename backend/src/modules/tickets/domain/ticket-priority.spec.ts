import { derivePriority, DEFAULT_PRIORITY } from './ticket-priority';

describe('derivePriority', () => {
  it('mapea las nueve combinaciones de impacto x urgencia', () => {
    expect(derivePriority('ALTO', 'ALTA')).toBe('P1');
    expect(derivePriority('ALTO', 'MEDIA')).toBe('P2');
    expect(derivePriority('ALTO', 'BAJA')).toBe('P3');

    expect(derivePriority('MEDIO', 'ALTA')).toBe('P2');
    expect(derivePriority('MEDIO', 'MEDIA')).toBe('P3');
    expect(derivePriority('MEDIO', 'BAJA')).toBe('P3');

    expect(derivePriority('BAJO', 'ALTA')).toBe('P3');
    expect(derivePriority('BAJO', 'MEDIA')).toBe('P4');
    expect(derivePriority('BAJO', 'BAJA')).toBe('P4');
  });

  it('cae a la prioridad por defecto cuando falta impacto o urgencia', () => {
    expect(derivePriority(null, 'ALTA')).toBe(DEFAULT_PRIORITY);
    expect(derivePriority('ALTO', null)).toBe(DEFAULT_PRIORITY);
    expect(derivePriority(null, null)).toBe(DEFAULT_PRIORITY);
    expect(DEFAULT_PRIORITY).toBe('P3');
  });
});
