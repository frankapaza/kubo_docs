import { incidentIntervals } from './incident-intervals';

const d = (s: string) => new Date(`2026-11-20T${s}:00.000Z`);
const until = d('23:00');
const iso = (xs: Array<{ kind: string; from: Date; to: Date }>) =>
  xs.map((x) => ({ kind: x.kind, from: x.from.toISOString(), to: x.to.toISOString() }));

describe('incidentIntervals', () => {
  it('DOWN recuperado: un intervalo DOWN de la primera falla a la recuperación', () => {
    expect(
      iso(incidentIntervals({ kind: 'DOWN', firstFailureAt: d('10:00'), recoveredAt: d('11:00') }, null, until)),
    ).toEqual(iso([{ kind: 'DOWN', from: d('10:00'), to: d('11:00') }]));
  });

  it('ROUTE abierto: llega hasta `until`', () => {
    expect(iso(incidentIntervals({ kind: 'ROUTE', firstFailureAt: d('10:00'), recoveredAt: null }, null, until))).toEqual(
      iso([{ kind: 'ROUTE', from: d('10:00'), to: until }]),
    );
  });

  it('ROUTE subido a DOWN: ROUTE hasta upgradedAt y DOWN desde ahí (la fila ya dice DOWN)', () => {
    for (const kind of ['ROUTE', 'DOWN'] as const) {
      expect(
        iso(incidentIntervals({ kind, firstFailureAt: d('10:00'), recoveredAt: d('12:00') }, d('10:30'), until)),
      ).toEqual(
        iso([
          { kind: 'ROUTE', from: d('10:00'), to: d('10:30') },
          { kind: 'DOWN', from: d('10:30'), to: d('12:00') },
        ]),
      );
    }
  });

  it('subido y abierto: DOWN hasta `until`', () => {
    expect(
      iso(incidentIntervals({ kind: 'DOWN', firstFailureAt: d('10:00'), recoveredAt: null }, d('10:30'), until)),
    ).toEqual(
      iso([
        { kind: 'ROUTE', from: d('10:00'), to: d('10:30') },
        { kind: 'DOWN', from: d('10:30'), to: until },
      ]),
    );
  });

  it('DEGRADED → []', () => {
    expect(
      incidentIntervals({ kind: 'DEGRADED', firstFailureAt: d('10:00'), recoveredAt: null }, null, until),
    ).toEqual([]);
  });

  it('nunca devuelve intervalos vacíos o invertidos', () => {
    expect(incidentIntervals({ kind: 'DOWN', firstFailureAt: d('23:30'), recoveredAt: null }, null, until)).toEqual([]);
  });
});
