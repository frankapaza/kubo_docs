import {
  canTransition,
  assertTransition,
  requiresReason,
  isCancellation,
  OPEN_STATUSES,
} from './ticket-state-machine';

describe('canTransition', () => {
  it('acepta el camino feliz completo', () => {
    expect(canTransition('NUEVO', 'TRIAJE')).toBe(true);
    expect(canTransition('TRIAJE', 'ASIGNADO')).toBe(true);
    expect(canTransition('ASIGNADO', 'EN_ATENCION')).toBe(true);
    expect(canTransition('EN_ATENCION', 'RESUELTO')).toBe(true);
    expect(canTransition('RESUELTO', 'CERRADO')).toBe(true);
  });

  it('acepta los desvios de espera y derivacion en ambos sentidos', () => {
    expect(canTransition('EN_ATENCION', 'ESPERA_CLIENTE')).toBe(true);
    expect(canTransition('ESPERA_CLIENTE', 'EN_ATENCION')).toBe(true);
    expect(canTransition('EN_ATENCION', 'DERIVADO')).toBe(true);
    expect(canTransition('DERIVADO', 'EN_ATENCION')).toBe(true);
  });

  it('acepta la reapertura desde RESUELTO', () => {
    expect(canTransition('RESUELTO', 'EN_ATENCION')).toBe(true);
  });

  it('permite cancelar desde cualquier estado abierto', () => {
    for (const s of OPEN_STATUSES) {
      expect(canTransition(s, 'CERRADO')).toBe(true);
    }
  });

  it('rechaza saltos invalidos', () => {
    expect(canTransition('NUEVO', 'RESUELTO')).toBe(false);
    expect(canTransition('NUEVO', 'EN_ATENCION')).toBe(false);
    expect(canTransition('TRIAJE', 'EN_ATENCION')).toBe(false);
    expect(canTransition('ASIGNADO', 'RESUELTO')).toBe(false);
    expect(canTransition('DERIVADO', 'RESUELTO')).toBe(false);
  });

  it('CERRADO es terminal', () => {
    expect(canTransition('CERRADO', 'EN_ATENCION')).toBe(false);
    expect(canTransition('CERRADO', 'CERRADO')).toBe(false);
  });
});

describe('assertTransition', () => {
  it('no lanza en una transicion valida', () => {
    expect(() => assertTransition('NUEVO', 'TRIAJE')).not.toThrow();
  });

  it('lanza INVALID_TRANSITION en una invalida', () => {
    expect(() => assertTransition('NUEVO', 'RESUELTO')).toThrow();
    try {
      assertTransition('NUEVO', 'RESUELTO');
    } catch (e: any) {
      expect(e.getResponse().code).toBe('INVALID_TRANSITION');
    }
  });
});

describe('isCancellation / requiresReason', () => {
  it('cerrar desde RESUELTO es cierre normal, no cancelacion', () => {
    expect(isCancellation('RESUELTO', 'CERRADO')).toBe(false);
    expect(requiresReason('RESUELTO', 'CERRADO')).toBe(false);
  });

  it('cerrar desde un estado abierto es cancelacion y exige motivo', () => {
    expect(isCancellation('EN_ATENCION', 'CERRADO')).toBe(true);
    expect(requiresReason('EN_ATENCION', 'CERRADO')).toBe(true);
    expect(requiresReason('NUEVO', 'CERRADO')).toBe(true);
  });

  it('derivar exige motivo', () => {
    expect(requiresReason('EN_ATENCION', 'DERIVADO')).toBe(true);
    expect(requiresReason('ASIGNADO', 'DERIVADO')).toBe(true);
  });

  it('reabrir exige motivo', () => {
    expect(requiresReason('RESUELTO', 'EN_ATENCION')).toBe(true);
  });

  it('las transiciones ordinarias no exigen motivo', () => {
    expect(requiresReason('ASIGNADO', 'EN_ATENCION')).toBe(false);
    expect(requiresReason('EN_ATENCION', 'ESPERA_CLIENTE')).toBe(false);
  });
});
