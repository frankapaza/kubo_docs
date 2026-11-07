import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { LokiClient, LokiLabels, LokiStream } from './loki.client';

const labels: LokiLabels = {
  instalacion: '1',
  cliente: 'interno',
  sistema: 'ninguno',
  aplicativo: 'APP',
  servidor: 'SRV',
  nivel: 'ERROR',
};

function make(env: Record<string, string> = {}) {
  const cfg = { get: (k: string, d?: string) => env[k] ?? d } as unknown as ConfigService;
  const client = new LokiClient(cfg);
  const fetchFn = jest.fn();
  client.fetchFn = fetchFn as unknown as typeof fetch;
  return { client, fetchFn };
}

const res = (status: number, body = '') => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => body,
});

describe('LokiClient.push', () => {
  const at = new Date('2026-11-07T10:00:00.123Z');
  const one: LokiStream[] = [{ labels, entries: [{ at, line: 'a' }] }];

  it('manda el formato de push de Loki con ns como cadena creciente', async () => {
    const { client, fetchFn } = make({ LOKI_URL: 'http://l:3100' });
    fetchFn.mockResolvedValue(res(204));
    const streams: LokiStream[] = [{ labels, entries: [{ at, line: 'a' }, { at, line: 'b' }] }];
    expect(await client.push(streams)).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://l:3100/loki/api/v1/push');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.streams[0].stream).toEqual(labels);
    const [[ns1, l1], [ns2, l2]] = body.streams[0].values;
    expect(ns1).toBe(String(BigInt(at.getTime()) * 1000000n));
    expect(typeof ns1).toBe('string');
    expect(l1).toBe('a');
    expect(l2).toBe('b');
    expect(BigInt(ns2)).toBeGreaterThan(BigInt(ns1));
  });

  it('por omisión usa http://loki:3100 y timeout de 5000', async () => {
    const { client, fetchFn } = make();
    fetchFn.mockResolvedValue(res(204));
    const spy = jest.spyOn(AbortSignal, 'timeout');
    await client.push(one);
    expect(fetchFn.mock.calls[0][0]).toBe('http://loki:3100/loki/api/v1/push');
    expect(spy).toHaveBeenCalledWith(5000);
    spy.mockRestore();
  });

  it('respeta LOKI_TIMEOUT_MS', async () => {
    const { client, fetchFn } = make({ LOKI_TIMEOUT_MS: '1234' });
    fetchFn.mockResolvedValue(res(204));
    const spy = jest.spyOn(AbortSignal, 'timeout');
    await client.push(one);
    expect(spy).toHaveBeenCalledWith(1234);
    spy.mockRestore();
  });

  it.each([500, 502, 503])('%i es reintentable', async (status) => {
    const { client, fetchFn } = make();
    fetchFn.mockResolvedValue(res(status, 'boom'));
    expect(await client.push(one)).toMatchObject({ ok: false, retryable: true, status });
  });

  it('timeout y red caída son reintentables, sin status', async () => {
    const { client, fetchFn } = make();
    fetchFn.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    expect(await client.push(one)).toMatchObject({ ok: false, retryable: true, status: null });
    fetchFn.mockRejectedValue(new TypeError('fetch failed'));
    expect(await client.push(one)).toMatchObject({ ok: false, retryable: true, status: null });
  });

  it('400 no es reintentable y trae el mensaje de Loki', async () => {
    const { client, fetchFn } = make();
    fetchFn.mockResolvedValue(res(400, 'entry too far behind'));
    expect(await client.push(one)).toEqual({
      ok: false,
      retryable: false,
      status: 400,
      message: 'entry too far behind',
    });
  });

  it('sin entradas no llama a Loki', async () => {
    const { client, fetchFn } = make();
    expect(await client.push([{ labels, entries: [] }])).toEqual({ ok: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('LokiClient.queryRange', () => {
  const start = new Date('2026-11-07T10:00:00.000Z');
  const end = new Date('2026-11-07T11:00:00.000Z');
  const payload = JSON.stringify({
    data: {
      result: [
        { stream: { nivel: 'ERROR' }, values: [['300', 'c'], ['100', 'a']] },
        { stream: { nivel: 'INFO' }, values: [['200', 'b']] },
      ],
    },
  });

  it('arma la query y aplana ordenando según direction', async () => {
    const { client, fetchFn } = make({ LOKI_URL: 'http://l:3100' });
    fetchFn.mockResolvedValue(res(200, payload));
    const back = await client.queryRange({ query: '{a="b"}', start, end, limit: 50, direction: 'backward' });
    const url = new URL(fetchFn.mock.calls[0][0]);
    expect(url.pathname).toBe('/loki/api/v1/query_range');
    expect(url.searchParams.get('query')).toBe('{a="b"}');
    expect(url.searchParams.get('start')).toBe(String(BigInt(start.getTime()) * 1000000n));
    expect(url.searchParams.get('end')).toBe(String(BigInt(end.getTime()) * 1000000n));
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('direction')).toBe('backward');
    expect(back.map((e) => e.line)).toEqual(['c', 'b', 'a']);
    expect(back[0]).toEqual({ labels: { nivel: 'ERROR' }, tsNs: '300', line: 'c' });

    const fwd = await client.queryRange({ query: 'q', start, end, limit: 5, direction: 'forward' });
    expect(fwd.map((e) => e.line)).toEqual(['a', 'b', 'c']);
  });

  it('lanza LOKI_UNAVAILABLE si Loki responde error o no responde', async () => {
    const { client, fetchFn } = make();
    const q = { query: 'q', start, end, limit: 5, direction: 'backward' as const };
    fetchFn.mockResolvedValue(res(500, 'x'));
    await expect(client.queryRange(q)).rejects.toBeInstanceOf(ServiceUnavailableException);
    fetchFn.mockRejectedValue(new Error('down'));
    await expect(client.queryRange(q)).rejects.toMatchObject({
      response: { code: 'LOKI_UNAVAILABLE' },
    });
  });
});

describe('LokiClient.ready', () => {
  it('true con 200, false con otra cosa o error', async () => {
    const { client, fetchFn } = make();
    fetchFn.mockResolvedValue(res(200, 'ready'));
    expect(await client.ready()).toBe(true);
    fetchFn.mockResolvedValue(res(503, 'not ready'));
    expect(await client.ready()).toBe(false);
    fetchFn.mockRejectedValue(new Error('x'));
    expect(await client.ready()).toBe(false);
  });
});
