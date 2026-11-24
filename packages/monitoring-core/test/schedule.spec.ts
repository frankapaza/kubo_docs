import { DEFAULT_SCHEDULE, intervalMsAt, nextCycleAt } from '../src/schedule';

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
