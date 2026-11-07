import { ServiceUnavailableException } from '@nestjs/common';
import { LogsService } from './logs.service';

const NOW = new Date('2026-11-07T15:00:00.000Z');
const nsOf = (d: Date) => BigInt(d.getTime()) * 1_000_000n;

const labels = {
  instalacion: '3',
  cliente: 'interno',
  sistema: 'ninguno',
  aplicativo: 'Facturador',
  servidor: 'SRV1',
  nivel: 'ERROR',
};

const entry = (tsNs: string, line: string, l: Record<string, string> = labels) => ({ labels: l, tsNs, line });

const make = (impl?: (q: any) => Promise<any[]>) => {
  const queryRange = jest.fn(impl ?? (async () => []));
  const svc = new LogsService({ queryRange } as any);
  return { svc, queryRange };
};

describe('LogsService.search', () => {
  it('sin rango busca la última hora', async () => {
    const { svc, queryRange } = make();
    await svc.search({}, NOW);
    const q = queryRange.mock.calls[0][0];
    expect(q.end.getTime()).toBe(NOW.getTime());
    expect(q.start.getTime()).toBe(NOW.getTime() - 3600 * 1000);
    expect(q.direction).toBe('backward');
  });

  it('un rango de más de 30 días responde 400', async () => {
    const { svc, queryRange } = make();
    await expect(svc.search({ desde: '2026-09-01T00:00:00Z', hasta: '2026-11-01T00:00:00Z' }, NOW)).rejects.toMatchObject({
      status: 400,
    });
    expect(queryRange).not.toHaveBeenCalled();
  });

  it('desde posterior a hasta responde 400', async () => {
    const { svc } = make();
    await expect(svc.search({ desde: '2026-11-02T00:00:00Z', hasta: '2026-11-01T00:00:00Z' }, NOW)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('limit por omisión 200 y tope 500', async () => {
    const { svc, queryRange } = make();
    await svc.search({}, NOW);
    await svc.search({ limit: 5000 }, NOW);
    await svc.search({ limit: 50 }, NOW);
    expect(queryRange.mock.calls.map((c) => c[0].limit)).toEqual([200, 500, 50]);
  });

  it('pagina hacia atrás: nextCursor es el ns del último devuelto menos 1 y la siguiente consulta lo usa como end', async () => {
    const base = nsOf(new Date(NOW.getTime() - 1000));
    const mk = (n: number) => entry(String(base - BigInt(n)), '{"mensaje":"m"}');
    const { svc, queryRange } = make(async () => [mk(0), mk(1), mk(2)]);
    const page = await svc.search({ limit: 3 }, NOW);
    // Más grande que 2^53: con Number perdería precisión.
    expect(page.nextCursor).toBe(String(base - 2n - 1n));

    await svc.search({ limit: 3, cursor: page.nextCursor! }, NOW);
    expect(queryRange.mock.calls[1][0].endNs).toBe(page.nextCursor);
  });

  it('con menos líneas que el límite nextCursor es null', async () => {
    const { svc } = make(async () => [entry('1762527000000000000', '{"mensaje":"m"}')]);
    const page = await svc.search({ limit: 3 }, NOW);
    expect(page.nextCursor).toBeNull();
    expect(page.lines).toHaveLength(1);
  });

  it('una línea que no es JSON se muestra como mensaje tal cual', async () => {
    const { svc } = make(async () => [entry('1762527000000000000', 'texto suelto { no json')]);
    const { lines } = await svc.search({}, NOW);
    expect(lines[0]).toMatchObject({ mensaje: 'texto suelto { no json', logger: '', excepcion: null, hilo: null, propiedades: {} });
  });

  it('Loki caído responde 503 LOKI_UNAVAILABLE', async () => {
    const { svc } = make(async () => {
      throw new ServiceUnavailableException({ code: 'LOKI_UNAVAILABLE', message: 'x' });
    });
    await expect(svc.search({}, NOW)).rejects.toMatchObject({ status: 503, response: { code: 'LOKI_UNAVAILABLE' } });
  });

  it('mapea etiquetas y línea JSON a la vista (interno y ninguno son null)', async () => {
    const line = JSON.stringify({
      logger: 'App.Svc',
      mensaje: 'falló',
      excepcion: 'Boom',
      hilo: '7',
      propiedades: { a: 'b', n: 1 },
    });
    const { svc } = make(async () => [
      entry('1762527000123456789', line),
      entry('1762527000000000001', line, { ...labels, cliente: '12', sistema: '4', nivel: 'WARN' }),
    ]);
    const { lines } = await svc.search({}, NOW);
    expect(lines[0]).toEqual({
      id: '1762527000123456789-0',
      ts: '2025-11-07T14:50:00.123Z',
      nivel: 'ERROR',
      instalacionId: 3,
      clienteId: null,
      sistemaId: null,
      aplicativo: 'Facturador',
      servidor: 'SRV1',
      logger: 'App.Svc',
      mensaje: 'falló',
      excepcion: 'Boom',
      hilo: '7',
      propiedades: { a: 'b', n: '1' },
    });
    expect(lines[1]).toMatchObject({ clienteId: 12, sistemaId: 4, nivel: 'WARN' });
  });

  it('un cursor fuera del rango no lo amplía', async () => {
    const { svc, queryRange } = make();
    await svc.search({ cursor: String(nsOf(NOW) * 2n) }, NOW);
    expect(queryRange.mock.calls[0][0].endNs).toBe(String(nsOf(NOW)));
  });

  it('un cursor anterior a desde devuelve vacío sin consultar', async () => {
    const { svc, queryRange } = make();
    const r = await svc.search({ cursor: '1000' }, NOW);
    expect(r).toEqual({ lines: [], nextCursor: null });
    expect(queryRange).not.toHaveBeenCalled();
  });
});
