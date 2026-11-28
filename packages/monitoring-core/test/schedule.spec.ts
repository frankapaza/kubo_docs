import { DEFAULT_SCHEDULE, intervalMsAt, nextCycleAt, assertValidSchedule, scheduleFor } from '../src/schedule';

const lima = (s: string) => new Date(`${s}-05:00`);

it('de día cada 5 min, de noche cada 1 min', () => {
  expect(intervalMsAt(lima('2026-11-23T06:59:59'), DEFAULT_SCHEDULE)).toBe(60_000);
  expect(intervalMsAt(lima('2026-11-23T07:00:00'), DEFAULT_SCHEDULE)).toBe(300_000);
  expect(intervalMsAt(lima('2026-11-23T21:59:59'), DEFAULT_SCHEDULE)).toBe(300_000);
  expect(intervalMsAt(lima('2026-11-23T22:00:00'), DEFAULT_SCHEDULE)).toBe(60_000);
});
it('alinea al reloj de Lima con el desfase del servicio', () => {
  // serviceOffsetMs(1) = 37 s
  expect(nextCycleAt(1, lima('2026-11-23T10:01:00'), DEFAULT_SCHEDULE)).toEqual(lima('2026-11-23T10:05:37'));
  expect(nextCycleAt(1, lima('2026-11-23T23:10:40'), DEFAULT_SCHEDULE)).toEqual(lima('2026-11-23T23:11:37'));
});
it('al cruzar las 22:00 pasa a la franja de 1 min sin saltarse la de las 22:00', () => {
  expect(nextCycleAt(1, lima('2026-11-23T21:55:37'), DEFAULT_SCHEDULE)).toEqual(lima('2026-11-23T22:00:37'));
  expect(nextCycleAt(1, lima('2026-11-23T22:00:37'), DEFAULT_SCHEDULE)).toEqual(lima('2026-11-23T22:01:37'));
});
it('al cruzar las 07:00 pasa a la franja de 5 min', () => {
  expect(nextCycleAt(1, lima('2026-11-24T06:59:37'), DEFAULT_SCHEDULE)).toEqual(lima('2026-11-24T07:00:37'));
  expect(nextCycleAt(1, lima('2026-11-24T07:00:37'), DEFAULT_SCHEDULE)).toEqual(lima('2026-11-24T07:05:37'));
});

describe('assertValidSchedule', () => {
  const ok = DEFAULT_SCHEDULE;
  it('DEFAULT_SCHEDULE es valido', () => expect(() => assertValidSchedule(ok)).not.toThrow());
  it.each([
    ['intervalo 0', { ...ok, dayIntervalMin: 0 }],
    ['intervalo negativo', { ...ok, nightIntervalMin: -1 }],
    ['intervalo que no divide 1440', { ...ok, dayIntervalMin: 7 }],
    ['dayStart >= nightStart', { ...ok, dayStartHour: 22, nightStartHour: 22 }],
    ['hora fuera de 0..23', { ...ok, nightStartHour: 24 }],
    ['hora negativa', { ...ok, dayStartHour: -1 }],
    ['frontera no multiplo de ambos intervalos', { ...ok, dayIntervalMin: 45 }],
  ])('%s lanza', (_n, cfg) => expect(() => assertValidSchedule(cfg)).toThrow(/Configuración/));
});

describe('scheduleFor', () => {
  it('sin intervalo propio devuelve el horario global; con él, ese intervalo de día y de noche', () => {
    expect(scheduleFor(DEFAULT_SCHEDULE, undefined)).toBe(DEFAULT_SCHEDULE);
    expect(scheduleFor(DEFAULT_SCHEDULE, 1)).toEqual({ ...DEFAULT_SCHEDULE, dayIntervalMin: 1, nightIntervalMin: 1 });
  });

  it('un intervalo que no divide 1440 o no es entero se ignora (horario global)', () => {
    expect(scheduleFor(DEFAULT_SCHEDULE, 7)).toBe(DEFAULT_SCHEDULE);
    expect(scheduleFor(DEFAULT_SCHEDULE, 0)).toBe(DEFAULT_SCHEDULE);
    expect(scheduleFor(DEFAULT_SCHEDULE, 1.5)).toBe(DEFAULT_SCHEDULE);
  });
});
