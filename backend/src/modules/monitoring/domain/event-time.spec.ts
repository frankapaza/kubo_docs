import { MAX_EVENT_AGE_MS, MAX_EVENT_FUTURE_MS, peruDay, resolveEventTime } from './event-time';

const recibido = new Date('2026-11-07T12:00:00.000Z');

describe('resolveEventTime', () => {
  it('conserva un ISO válido dentro de la ventana', () => {
    const r = resolveEventTime('2026-11-07T11:59:30.000Z', recibido);
    expect(r.at.toISOString()).toBe('2026-11-07T11:59:30.000Z');
    expect(r.original).toBeNull();
  });

  it('sustituye por la hora de recepción lo de hace 8 días', () => {
    const raw = '2026-10-30T11:00:00.000Z';
    const r = resolveEventTime(raw, recibido);
    expect(r.at).toEqual(recibido);
    expect(r.original).toBe(raw);
  });

  it('sustituye lo que está 10 minutos en el futuro', () => {
    const raw = '2026-11-07T12:10:00.000Z';
    const r = resolveEventTime(raw, recibido);
    expect(r.at).toEqual(recibido);
    expect(r.original).toBe(raw);
  });

  it('sustituye una cadena que no es fecha', () => {
    const r = resolveEventTime('no-es-fecha', recibido);
    expect(r.at).toEqual(recibido);
    expect(r.original).toBe('no-es-fecha');
  });

  it('sustituye undefined', () => {
    const r = resolveEventTime(undefined, recibido);
    expect(r.at).toEqual(recibido);
    expect(r.original).toBe('undefined');
  });

  it('sin zona explícita no se acepta (dependería de la zona del proceso)', () => {
    const raw = '2026-11-07T11:59:00';
    const r = resolveEventTime(raw, recibido);
    expect(r.at).toEqual(recibido);
    expect(r.original).toBe(raw);
  });

  it('acepta desfases explícitos +00:00 y -05:00', () => {
    expect(resolveEventTime('2026-11-07T11:59:00+00:00', recibido).at.toISOString()).toBe(
      '2026-11-07T11:59:00.000Z',
    );
    const r = resolveEventTime('2026-11-07T06:59:00-05:00', recibido);
    expect(r.at.toISOString()).toBe('2026-11-07T11:59:00.000Z');
    expect(r.original).toBeNull();
  });

  it('el original no parte un par sustituto', () => {
    const r = resolveEventTime('a'.repeat(63) + '😀', recibido);
    expect(r.original).toBe('a'.repeat(63));
  });

  it('los bordes de la ventana son inclusivos', () => {
    const viejo = new Date(recibido.getTime() - MAX_EVENT_AGE_MS).toISOString();
    const futuro = new Date(recibido.getTime() + MAX_EVENT_FUTURE_MS).toISOString();
    expect(resolveEventTime(viejo, recibido).original).toBeNull();
    expect(resolveEventTime(futuro, recibido).original).toBeNull();
  });
});

describe('peruDay', () => {
  it('usa el día civil de Perú, no el de UTC', () => {
    expect(peruDay(new Date('2026-11-08T03:00:00Z'))).toBe('2026-11-07');
    expect(peruDay(new Date('2026-11-08T05:00:00Z'))).toBe('2026-11-08');
  });
});
