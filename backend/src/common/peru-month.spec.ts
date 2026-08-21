import { peruMonthBounds, isPeruMonthClosed, PERU_UTC_OFFSET_MINUTES } from './peru-month';
import { PERU_TIME_ZONE } from './time-zone';

describe('peruMonthBounds', () => {
  it('empieza a medianoche civil de Lima, que son las 05:00 UTC', () => {
    const { from, to } = peruMonthBounds(2026, 8);
    expect(from.toISOString()).toBe('2026-08-01T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-01T05:00:00.000Z');
  });

  it('cruza bien el fin de año', () => {
    const { from, to } = peruMonthBounds(2026, 12);
    expect(from.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(to.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });

  // La razón de ser de este módulo: en UTC, las 20:00 del último día del mes
  // en Lima ya son el día 1 del mes siguiente. Sin esto, al cliente le
  // desaparecería del informe algo que él vivió dentro del mes.
  it('las 20:00 del ultimo dia en Lima pertenecen a ese mes', () => {
    const { from, to } = peruMonthBounds(2026, 8);
    const ultimoDiaTarde = new Date('2026-09-01T01:00:00.000Z'); // 31/08 20:00 en Lima
    expect(ultimoDiaTarde >= from && ultimoDiaTarde < to).toBe(true);
  });

  it('rechaza un mes fuera de rango', () => {
    expect(() => peruMonthBounds(2026, 0)).toThrow();
    expect(() => peruMonthBounds(2026, 13)).toThrow();
  });
});

describe('isPeruMonthClosed', () => {
  it('un mes anterior esta cerrado', () => {
    expect(isPeruMonthClosed(2026, 7, new Date('2026-08-07T12:00:00Z'))).toBe(true);
  });

  it('el mes en curso no esta cerrado', () => {
    expect(isPeruMonthClosed(2026, 8, new Date('2026-08-07T12:00:00Z'))).toBe(false);
  });

  it('un mes futuro no esta cerrado', () => {
    expect(isPeruMonthClosed(2026, 12, new Date('2026-08-07T12:00:00Z'))).toBe(false);
  });

  // El instante exacto del cambio: 00:00 del dia 1 en Lima = 05:00 UTC.
  it('agosto cierra a las 05:00 UTC del 1 de septiembre, ni un minuto antes', () => {
    expect(isPeruMonthClosed(2026, 8, new Date('2026-09-01T04:59:59Z'))).toBe(false);
    expect(isPeruMonthClosed(2026, 8, new Date('2026-09-01T05:00:00Z'))).toBe(true);
  });
});

describe('el supuesto de que Peru no cambia la hora', () => {
  // Esta prueba no comprueba nuestro codigo: comprueba el HECHO en el que se
  // apoya. Si Peru adoptara horario de verano, o si cambiaran los datos de
  // zonas del sistema, `peruMonthBounds` empezaria a desplazar los informes
  // en silencio. Preferimos que falle aqui, en voz alta.
  it.each([1, 4, 7, 10])('el desfase es de -300 minutos tambien en el mes %i', (mes) => {
    const instante = new Date(Date.UTC(2026, mes - 1, 15, 12, 0, 0));
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: PERU_TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(instante);
    const v = (t: string) => Number(partes.find((p) => p.type === t)!.value);
    const comoSiFueraUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
    expect((comoSiFueraUtc - instante.getTime()) / 60000).toBe(PERU_UTC_OFFSET_MINUTES);
  });
});
