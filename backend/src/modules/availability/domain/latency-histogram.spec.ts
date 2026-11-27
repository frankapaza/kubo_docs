import {
  LATENCY_BUCKETS_MS,
  PERCENT_BUCKETS,
  histogramOf,
  mergeHistograms,
  percentileFromHistogram,
} from './latency-histogram';

const idx = (ms: number) => LATENCY_BUCKETS_MS.indexOf(ms);

describe('latency-histogram', () => {
  it('las cubetas de latencia son los límites inferiores pedidos; la última llega a +∞', () => {
    expect(LATENCY_BUCKETS_MS).toEqual([
      0, 25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000,
    ]);
  });

  it('PERCENT_BUCKETS va de 0 a 100 de 5 en 5 (21 cubetas)', () => {
    expect(PERCENT_BUCKETS).toHaveLength(21);
    expect(PERCENT_BUCKETS[0]).toBe(0);
    expect(PERCENT_BUCKETS[1]).toBe(5);
    expect(PERCENT_BUCKETS[20]).toBe(100);
  });

  it('histogramOf([10, 30, 30, 1200]) → cubeta 0 = 1, cubeta 25 = 2, cubeta 1000 = 1', () => {
    const h = histogramOf([10, 30, 30, 1200]);
    expect(h).toHaveLength(LATENCY_BUCKETS_MS.length);
    expect(h[idx(0)]).toBe(1);
    expect(h[idx(25)]).toBe(2);
    expect(h[idx(1000)]).toBe(1);
    expect(h.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('el límite inferior es inclusivo y los valores enormes caen en la última cubeta', () => {
    const h = histogramOf([25, 24, 10000, 999999]);
    expect(h[idx(0)]).toBe(1);
    expect(h[idx(25)]).toBe(1);
    expect(h[idx(10000)]).toBe(2);
  });

  it('percentileFromHistogram(..., 0.5) → 50 (límite superior de la cubeta que alcanza p)', () => {
    const h = histogramOf([10, 30, 30, 1200]);
    expect(percentileFromHistogram(h, 0.5)).toBe(50);
    expect(percentileFromHistogram(h, 0.95)).toBe(1500);
  });

  it('la última cubeta devuelve su límite inferior', () => {
    expect(percentileFromHistogram(histogramOf([20000]), 0.5)).toBe(10000);
  });

  it('un histograma vacío → null', () => {
    expect(percentileFromHistogram(histogramOf([]), 0.5)).toBeNull();
    expect(percentileFromHistogram([], 0.95)).toBeNull();
  });

  it('mergeHistograms suma cubeta a cubeta', () => {
    expect(mergeHistograms([[1, 2, 0], [0, 1, 3]])).toEqual([1, 3, 3]);
    expect(mergeHistograms([])).toEqual([]);
  });

  it('sirve para CPU/RAM con PERCENT_BUCKETS', () => {
    const h = histogramOf([0, 4.9, 50, 100], PERCENT_BUCKETS);
    expect(h).toHaveLength(21);
    expect(h[0]).toBe(2);
    expect(h[10]).toBe(1);
    expect(h[20]).toBe(1);
    expect(percentileFromHistogram(h, 0.5, PERCENT_BUCKETS)).toBe(5);
  });
});
