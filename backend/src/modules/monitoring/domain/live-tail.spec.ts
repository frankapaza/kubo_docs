import { LiveLogLine, LIVE_MAX_LINES_PER_SECOND, matchesLogFilter, takeLiveBudget } from './live-tail';

const line = (o: Partial<LiveLogLine> = {}): LiveLogLine => ({
  ts: '2026-11-07T10:00:00.000Z', nivel: 'ERROR', instalacionId: 1, clienteId: 5, sistemaId: 2,
  aplicativo: 'Facturador', servidor: 'SRV1', logger: 'App.Pagos', mensaje: 'Falló el cobro',
  excepcion: 'NullReferenceException', hilo: '7', ...o,
});

describe('matchesLogFilter', () => {
  it('un filtro vacío deja pasar todo', () => {
    expect(matchesLogFilter({}, line())).toBe(true);
  });
  it('filtra por instalación, cliente, sistema, aplicativo y servidor', () => {
    expect(matchesLogFilter({ instalacionId: 1 }, line())).toBe(true);
    expect(matchesLogFilter({ instalacionId: 2 }, line())).toBe(false);
    expect(matchesLogFilter({ cliente: 5 }, line())).toBe(true);
    expect(matchesLogFilter({ cliente: 6 }, line())).toBe(false);
    expect(matchesLogFilter({ sistemaId: 3 }, line())).toBe(false);
    expect(matchesLogFilter({ aplicativo: 'Facturador' }, line())).toBe(true);
    expect(matchesLogFilter({ aplicativo: 'Otro' }, line())).toBe(false);
    expect(matchesLogFilter({ servidor: 'SRV2' }, line())).toBe(false);
  });
  it("cliente 'interno' casa con clienteId nulo", () => {
    expect(matchesLogFilter({ cliente: 'interno' }, line({ clienteId: null }))).toBe(true);
    expect(matchesLogFilter({ cliente: 'interno' }, line())).toBe(false);
    expect(matchesLogFilter({ cliente: 5 }, line({ clienteId: null }))).toBe(false);
  });
  it('filtra por nivel mínimo', () => {
    expect(matchesLogFilter({ nivelMinimo: 'ERROR' }, line({ nivel: 'WARN' }))).toBe(false);
    expect(matchesLogFilter({ nivelMinimo: 'WARN' }, line({ nivel: 'FATAL' }))).toBe(true);
  });
  it('texto sin distinguir mayúsculas sobre mensaje, excepción y logger', () => {
    expect(matchesLogFilter({ texto: 'COBRO' }, line())).toBe(true);
    expect(matchesLogFilter({ texto: 'nullreference' }, line({ mensaje: 'x' }))).toBe(true);
    expect(matchesLogFilter({ texto: 'app.pagos' }, line({ mensaje: 'x', excepcion: null }))).toBe(true);
    expect(matchesLogFilter({ texto: 'nada' }, line({ excepcion: null }))).toBe(false);
  });
});

describe('takeLiveBudget', () => {
  it('deja 200 en un segundo, 0 el resto y vuelve a 200 en la ventana siguiente', () => {
    const a = takeLiveBudget(undefined, 500, 1000);
    expect(a.allowed).toBe(LIVE_MAX_LINES_PER_SECOND);
    expect(LIVE_MAX_LINES_PER_SECOND).toBe(200);
    const b = takeLiveBudget(a.budget, 10, 1500);
    expect(b.allowed).toBe(0);
    const c = takeLiveBudget(b.budget, 500, 2000);
    expect(c.allowed).toBe(200);
  });
  it('reparte el tope entre varias llamadas de la misma ventana', () => {
    const a = takeLiveBudget(undefined, 150, 0);
    const b = takeLiveBudget(a.budget, 150, 10);
    expect(a.allowed).toBe(150);
    expect(b.allowed).toBe(50);
  });
});
