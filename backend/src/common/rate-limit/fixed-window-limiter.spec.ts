import { FixedWindowLimiter } from './fixed-window-limiter';

describe('FixedWindowLimiter', () => {
  const T0 = 1_800_000_000_000;

  it('deja pasar el máximo y el siguiente recibe el resto de la ventana', () => {
    const l = new FixedWindowLimiter(60, 60_000);
    for (let i = 0; i < 60; i++) expect(l.take(7, T0 + i)).toEqual({ ok: true });
    expect(l.take(7, T0 + 15_000)).toEqual({ ok: false, retryAfterSec: 45 });
  });

  it('nunca pide esperar 0 segundos', () => {
    const l = new FixedWindowLimiter(1, 60_000);
    l.take(1, T0);
    expect(l.take(1, T0 + 59_999)).toEqual({ ok: false, retryAfterSec: 1 });
  });

  it('cada clave cuenta por separado y la ventana siguiente reinicia', () => {
    const l = new FixedWindowLimiter(1, 60_000);
    l.take(1, T0);
    expect(l.take(2, T0)).toEqual({ ok: true });
    expect(l.take(1, T0 + 60_000)).toEqual({ ok: true });
  });
});
