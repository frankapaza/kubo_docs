import { addDays, expectedSlots, limaDateOf, limaDayBounds } from './expected-slots';

describe('expected-slots', () => {
  it('limaDayBounds: 00:00 de Lima (UTC-5) a 00:00 del día siguiente', () => {
    const { from, to } = limaDayBounds('2026-11-20');
    expect(from.toISOString()).toBe('2026-11-20T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-21T05:00:00.000Z');
  });

  it('expectedSlots = 720 (180 de día + 540 de noche) para cualquier servicio de 1 a 50', () => {
    for (let id = 1; id <= 50; id++) expect(expectedSlots(id, '2026-11-20')).toBe(720);
  });

  it('respeta la configuración recibida', () => {
    const cfg = { dayStartHour: 7, nightStartHour: 22, dayIntervalMin: 5, nightIntervalMin: 5 };
    expect(expectedSlots(3, '2026-11-20', cfg)).toBe(288);
  });

  it('limaDateOf y addDays trabajan en fechas de Lima', () => {
    expect(limaDateOf(new Date('2026-11-21T04:59:59Z'))).toBe('2026-11-20');
    expect(limaDateOf(new Date('2026-11-21T05:00:00Z'))).toBe('2026-11-21');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
