import {
  reorder,
  insertionIndex,
  requiresReason,
  assertReason,
  BOARD_COLUMNS,
  DEFAULT_PRIORITY,
} from './work-item-board';

describe('BOARD_COLUMNS', () => {
  it('son las cuatro columnas de flujo, en orden', () => {
    expect(BOARD_COLUMNS).toEqual(['PENDIENTE', 'EN_PROCESO', 'PRUEBAS', 'CERRADO']);
  });

  it('la prioridad por defecto es MEDIA', () => {
    expect(DEFAULT_PRIORITY).toBe('MEDIA');
  });
});

describe('requiresReason', () => {
  it('exige motivo al bloquear y al cancelar', () => {
    expect(requiresReason('BLOQUEADO')).toBe(true);
    expect(requiresReason('CANCELADO')).toBe(true);
  });

  it('no exige motivo en las columnas de flujo', () => {
    expect(requiresReason('PENDIENTE')).toBe(false);
    expect(requiresReason('EN_PROCESO')).toBe(false);
    expect(requiresReason('PRUEBAS')).toBe(false);
    expect(requiresReason('CERRADO')).toBe(false);
  });
});

describe('assertReason', () => {
  it('lanza BAD_INPUT para BLOQUEADO sin motivo (undefined)', () => {
    expect(() => assertReason('BLOQUEADO', undefined)).toThrow();
    try {
      assertReason('BLOQUEADO', undefined);
    } catch (e: any) {
      expect(e.getResponse().code).toBe('BAD_INPUT');
    }
  });

  it('lanza BAD_INPUT para BLOQUEADO con null', () => {
    expect(() => assertReason('BLOQUEADO', null)).toThrow();
    try {
      assertReason('BLOQUEADO', null);
    } catch (e: any) {
      expect(e.getResponse().code).toBe('BAD_INPUT');
    }
  });

  it('lanza BAD_INPUT para BLOQUEADO con string vacio', () => {
    expect(() => assertReason('BLOQUEADO', '')).toThrow();
    try {
      assertReason('BLOQUEADO', '');
    } catch (e: any) {
      expect(e.getResponse().code).toBe('BAD_INPUT');
    }
  });

  it('lanza BAD_INPUT para BLOQUEADO con solo espacios', () => {
    expect(() => assertReason('BLOQUEADO', '   ')).toThrow();
    try {
      assertReason('BLOQUEADO', '   ');
    } catch (e: any) {
      expect(e.getResponse().code).toBe('BAD_INPUT');
    }
  });

  it('lanza BAD_INPUT para CANCELADO sin motivo', () => {
    expect(() => assertReason('CANCELADO', undefined)).toThrow();
    try {
      assertReason('CANCELADO', undefined);
    } catch (e: any) {
      expect(e.getResponse().code).toBe('BAD_INPUT');
    }
  });

  it('no lanza para BLOQUEADO con motivo valido', () => {
    expect(() => assertReason('BLOQUEADO', 'Esperando aprobacion')).not.toThrow();
  });

  it('no lanza para CANCELADO con motivo valido', () => {
    expect(() => assertReason('CANCELADO', 'No aplica')).not.toThrow();
  });

  it('no lanza para columnas de flujo sin motivo', () => {
    expect(() => assertReason('PENDIENTE', undefined)).not.toThrow();
    expect(() => assertReason('EN_PROCESO', null)).not.toThrow();
    expect(() => assertReason('PRUEBAS', '')).not.toThrow();
    expect(() => assertReason('CERRADO', '   ')).not.toThrow();
  });

  it('no lanza para columnas de flujo con motivo', () => {
    expect(() => assertReason('PENDIENTE', 'Razon')).not.toThrow();
    expect(() => assertReason('EN_PROCESO', 'Razon')).not.toThrow();
    expect(() => assertReason('PRUEBAS', 'Razon')).not.toThrow();
    expect(() => assertReason('CERRADO', 'Razon')).not.toThrow();
  });
});

describe('reorder', () => {
  it('mueve hacia abajo dentro de la misma columna', () => {
    expect(reorder([1, 2, 3], 1, 2)).toEqual([2, 3, 1]);
  });

  it('mueve hacia arriba dentro de la misma columna', () => {
    expect(reorder([1, 2, 3], 3, 0)).toEqual([3, 1, 2]);
  });

  it('deja el orden intacto si se suelta en su misma posicion', () => {
    expect(reorder([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });

  it('inserta un item que viene de otra columna', () => {
    expect(reorder([1, 2], 9, 1)).toEqual([1, 9, 2]);
  });

  it('inserta en una columna vacia', () => {
    expect(reorder([], 5, 0)).toEqual([5]);
  });

  it('acota un indice mayor que la longitud', () => {
    expect(reorder([1, 2], 9, 99)).toEqual([1, 2, 9]);
  });

  it('acota un indice negativo', () => {
    expect(reorder([1, 2], 9, -3)).toEqual([9, 1, 2]);
  });

  it('no muta el array de entrada', () => {
    const input = [1, 2, 3];
    reorder(input, 1, 2);
    expect(input).toEqual([1, 2, 3]);
  });
});

describe('insertionIndex', () => {
  it('coloca un ALTA justo antes del primer MEDIA', () => {
    expect(insertionIndex(['ALTA', 'ALTA', 'MEDIA', 'BAJA'], 'ALTA')).toBe(2);
  });

  it('coloca un MEDIA justo antes del primer BAJA', () => {
    expect(insertionIndex(['ALTA', 'ALTA', 'MEDIA', 'BAJA'], 'MEDIA')).toBe(3);
  });

  it('coloca un BAJA al final', () => {
    expect(insertionIndex(['ALTA', 'ALTA', 'MEDIA', 'BAJA'], 'BAJA')).toBe(4);
  });

  it('coloca cualquier prioridad en 0 si la columna esta vacia', () => {
    expect(insertionIndex([], 'ALTA')).toBe(0);
    expect(insertionIndex([], 'BAJA')).toBe(0);
  });

  it('coloca un ALTA al principio si solo hay prioridades inferiores', () => {
    expect(insertionIndex(['MEDIA', 'BAJA'], 'ALTA')).toBe(0);
  });

  it('coloca al final si todas las existentes son de igual o mayor prioridad', () => {
    expect(insertionIndex(['ALTA', 'ALTA'], 'ALTA')).toBe(2);
  });
});
