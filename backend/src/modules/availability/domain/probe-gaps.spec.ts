import { probeGaps, subtractIntervals } from './probe-gaps';

const t = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00.000Z`);
const iso = (gs: Array<[Date, Date]>) => gs.map(([a, b]) => [a.toISOString(), b.toISOString()]);

describe('probeGaps', () => {
  const from = t('00:00');
  const to = new Date('2026-11-21T00:00:00.000Z');
  const TEN = 10 * 60_000;

  it('checks a las 10:00 y 10:25 con min 10 min → el hueco entre ellos más los bordes', () => {
    expect(iso(probeGaps([t('10:00'), t('10:25')], from, to, TEN))).toEqual(
      iso([
        [from, t('10:00')],
        [t('10:00'), t('10:25')],
        [t('10:25'), to],
      ]),
    );
  });

  it('sin checks → todo el día', () => {
    expect(iso(probeGaps([], from, to))).toEqual(iso([[from, to]]));
  });

  it('silencios de 10 min o menos no son hueco (por defecto PROBE_SILENCE_MS)', () => {
    const checks: Date[] = [];
    for (let m = 0; m < 24 * 60; m += 10) checks.push(new Date(from.getTime() + m * 60_000));
    expect(probeGaps(checks, from, to)).toEqual([]);
  });

  it('ignora checks fuera del día', () => {
    expect(iso(probeGaps([new Date(from.getTime() - 1000), new Date(to.getTime() + 1000)], from, to))).toEqual(
      iso([[from, to]]),
    );
  });
});

describe('subtractIntervals', () => {
  it('quita las caídas de oficina del hueco y deja solo lo que queda fuera', () => {
    const r = subtractIntervals([t('10:00'), t('11:00')], [
      [t('10:20'), t('10:30')],
      [t('10:50'), t('12:00')],
    ]);
    expect(iso(r)).toEqual(iso([[t('10:00'), t('10:20')], [t('10:30'), t('10:50')]]));
  });

  it('un hueco dentro de una caída desaparece', () => {
    expect(subtractIntervals([t('10:00'), t('11:00')], [[t('09:00'), t('12:00')]])).toEqual([]);
  });

  it('sin caídas queda igual', () => {
    expect(iso(subtractIntervals([t('10:00'), t('11:00')], []))).toEqual(iso([[t('10:00'), t('11:00')]]));
  });
});
