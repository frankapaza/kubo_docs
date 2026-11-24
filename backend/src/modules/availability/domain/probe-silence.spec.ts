import { PROBE_SILENCE_MS, silenceDecision } from './probe-silence';

const NOW = new Date('2026-11-24T15:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const base = { lastSeenAt: ago(0), silenceAlertedAt: null, hasToken: true, kind: 'OFFICE' as const };

describe('silenceDecision', () => {
  it('9 minutos sin reportar: NONE', () => {
    expect(silenceDecision({ ...base, lastSeenAt: ago(9 * 60_000) }, NOW)).toBe('NONE');
  });

  it('10 minutos sin reportar: ALERT', () => {
    expect(silenceDecision({ ...base, lastSeenAt: ago(PROBE_SILENCE_MS) }, NOW)).toBe('ALERT');
  });

  it('ya avisada y sigue callada: NONE', () => {
    expect(
      silenceDecision({ ...base, lastSeenAt: ago(30 * 60_000), silenceAlertedAt: ago(20 * 60_000) }, NOW),
    ).toBe('NONE');
  });

  it('ya avisada y vuelve a reportar: RECOVERED', () => {
    expect(
      silenceDecision({ ...base, lastSeenAt: ago(1000), silenceAlertedAt: ago(20 * 60_000) }, NOW),
    ).toBe('RECOVERED');
  });

  it('oficina sin token y sin lastSeenAt: NONE', () => {
    expect(silenceDecision({ ...base, lastSeenAt: null, hasToken: false }, NOW)).toBe('NONE');
  });

  it('sonda que nunca reportó (lastSeenAt nulo): NONE', () => {
    expect(silenceDecision({ ...base, lastSeenAt: null, kind: 'DATACENTER' }, NOW)).toBe('NONE');
  });
});
