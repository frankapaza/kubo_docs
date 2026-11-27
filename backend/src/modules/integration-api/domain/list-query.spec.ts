import { decodeCursor, encodeCursor, parseListQuery } from './list-query';

const T = ['NUEVO', 'EN_ATENCION', 'CERRADO'];
const P = ['P1', 'P2', 'P3', 'P4'];
const bad = { response: expect.objectContaining({ code: 'BAD_INPUT' }) };

describe('cursor', () => {
  it('ida y vuelta conserva fecha (ms) e id', () => {
    const c = { t: new Date('2026-11-27T10:00:00.123Z'), i: 42 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it('base64 roto, JSON sin id o fecha inválida -> 400 BAD_INPUT', () => {
    expect(() => decodeCursor('###')).toThrow(expect.objectContaining(bad));
    expect(() => decodeCursor(Buffer.from('{"t":"2026-11-27T10:00:00Z"}').toString('base64url'))).toThrow(expect.objectContaining(bad));
    expect(() => decodeCursor(Buffer.from('{"t":"ayer","i":1}').toString('base64url'))).toThrow(expect.objectContaining(bad));
    expect(() => decodeCursor(Buffer.from('{"t":"2026-11-27T10:00:00Z","i":-1}').toString('base64url'))).toThrow(expect.objectContaining(bad));
  });
});

describe('parseListQuery', () => {
  it('sin parámetros: límite 100 y nada más', () => {
    expect(parseListQuery({}, { estados: T, prioridades: P, csv: false })).toEqual({ limite: 100 });
  });
  it('estado con varios valores separados por coma', () => {
    expect(parseListQuery({ estado: 'NUEVO,EN_ATENCION' }, { estados: T, prioridades: P, csv: false }).estados).toEqual(['NUEVO', 'EN_ATENCION']);
  });
  it('estado o prioridad desconocidos -> 400', () => {
    expect(() => parseListQuery({ estado: 'FOO' }, { estados: T, prioridades: P, csv: false })).toThrow(expect.objectContaining(bad));
    expect(() => parseListQuery({ prioridad: 'P9' }, { estados: T, prioridades: P, csv: false })).toThrow(expect.objectContaining(bad));
  });
  it('límite: 501 -> 400 en JSON; 5000 vale en CSV; 5001 -> 400 en CSV; 0 -> 400', () => {
    expect(() => parseListQuery({ limite: '501' }, { estados: T, prioridades: P, csv: false })).toThrow(expect.objectContaining(bad));
    expect(parseListQuery({ limite: '5000' }, { estados: T, prioridades: P, csv: true }).limite).toBe(5000);
    expect(() => parseListQuery({ limite: '5001' }, { estados: T, prioridades: P, csv: true })).toThrow(expect.objectContaining(bad));
    expect(() => parseListQuery({ limite: '0' }, { estados: T, prioridades: P, csv: false })).toThrow(expect.objectContaining(bad));
  });
  it('fechas ISO válidas se convierten; texto libre -> 400', () => {
    const q = parseListQuery({ actualizadosDesde: '2026-11-01T00:00:00Z', creadosHasta: '2026-11-30' }, { estados: T, prioridades: P, csv: false });
    expect(q.actualizadosDesde).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(() => parseListQuery({ actualizadosDesde: 'ayer' }, { estados: T, prioridades: P, csv: false })).toThrow(expect.objectContaining(bad));
  });
  it('una fecha sin hora es un día de Lima: desde = 00:00 Lima; hasta = fin de ese día en Lima', () => {
    const q = parseListQuery({ creadosDesde: '2026-11-01', creadosHasta: '2026-11-30', actualizadosDesde: '2026-11-15' }, { estados: T, prioridades: P, csv: false });
    expect(q.creadosDesde).toEqual(new Date('2026-11-01T05:00:00.000Z'));
    expect(q.actualizadosDesde).toEqual(new Date('2026-11-15T05:00:00.000Z'));
    expect(q.creadosHasta).toEqual(new Date('2026-12-01T04:59:59.999Z'));
  });

  it('con hora y zona se respeta tal cual', () => {
    const q = parseListQuery({ creadosHasta: '2026-11-30T12:00:00Z' }, { estados: T, prioridades: P, csv: false });
    expect(q.creadosHasta).toEqual(new Date('2026-11-30T12:00:00Z'));
  });

  it('sistemaId entero positivo; otro valor -> 400', () => {
    expect(parseListQuery({ sistemaId: '12' }, { estados: T, prioridades: P, csv: false }).sistemaId).toBe(12);
    expect(() => parseListQuery({ sistemaId: 'x' }, { estados: T, prioridades: P, csv: false })).toThrow(expect.objectContaining(bad));
  });
  it('un parámetro repetido (array) o desconocido -> 400', () => {
    expect(() => parseListQuery({ estado: ['NUEVO', 'CERRADO'] }, { estados: T, prioridades: P, csv: false })).toThrow(expect.objectContaining(bad));
    expect(() => parseListQuery({ clientId: '9' }, { estados: T, prioridades: P, csv: false })).toThrow(expect.objectContaining(bad));
  });
});
