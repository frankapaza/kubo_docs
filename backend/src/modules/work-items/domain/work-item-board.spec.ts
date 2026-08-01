import {
  reorder,
  insertionIndex,
  requiresReason,
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
