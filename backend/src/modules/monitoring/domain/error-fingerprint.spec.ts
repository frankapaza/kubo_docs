import {
  computeErrorFingerprint,
  firstOwnFrame,
  normalizeMessage,
  parseException,
} from './error-fingerprint';

const EN = `System.NullReferenceException: Object reference not set
   at System.Collections.Generic.List\`1.Add(T item)
   at GCC.BL.Pagos.Aplicar(Int32 id) in C:\\src\\Pagos.cs:line 42
   at Microsoft.AspNet.Foo.Bar()`;
const ES = `System.NullReferenceException: Referencia no establecida
   en System.Collections.Generic.List\`1.Add(T item)
   en GCC.BL.Pagos.Aplicar(Int32 id) en C:\\src\\Pagos.cs:línea 42
   en Microsoft.AspNet.Foo.Bar()`;

describe('normalizeMessage', () => {
  it('reemplaza guid, fecha, ruta, hex y números en ese orden', () => {
    expect(
      normalizeMessage(
        'Pedido 12345 del cliente 3f2504e0-4f89-11d3-9a0c-0305e82c3301 falló el 07/11/2026 10:15:00 en C:\\inetpub\\gcc\\x.config (0x1A)',
      ),
    ).toBe('Pedido <n> del cliente <guid> falló el <fecha> en <ruta> (<hex>)');
  });
  it('fecha ISO', () => {
    expect(normalizeMessage('a las 2026-11-07T10:15:00.123Z falló')).toBe('a las <fecha> falló');
  });
  it('hora suelta, UNC, Unix y decimales', () => {
    expect(normalizeMessage('a las 10:15:00')).toBe('a las <hora>');
    expect(normalizeMessage('abre \\\\srv\\share\\f.txt')).toBe('abre <ruta>');
    expect(normalizeMessage('abre /var/log/app.log ya')).toBe('abre <ruta> ya');
    expect(normalizeMessage('tardó 3.75 s')).toBe('tardó <n> s');
  });
  it('colapsa espacios y recorta a 500', () => {
    expect(normalizeMessage('a   b \n c')).toBe('a b c');
    expect(normalizeMessage('x'.repeat(900))).toHaveLength(500);
  });
});

describe('parseException', () => {
  it('inglés y español dan el mismo tipo y marcos sin ruta ni línea', () => {
    const en = parseException(EN);
    const es = parseException(ES);
    expect(en.type).toBe('System.NullReferenceException');
    expect(es.type).toBe(en.type);
    expect(es.frames).toEqual(en.frames);
    expect(en.frames).toContain('GCC.BL.Pagos.Aplicar(Int32 id)');
    expect(en.frames.join('|')).not.toMatch(/Pagos\.cs|line 42/);
  });
  it('con excepción interna toma el tipo exterior', () => {
    const t = `System.InvalidOperationException: externa ---> System.IO.IOException: interna
   at GCC.X.Y()
   --- End of inner exception stack trace ---`;
    expect(parseException(t).type).toBe('System.InvalidOperationException');
  });
  it('null o vacío', () => {
    expect(parseException(null)).toEqual({ type: null, frames: [] });
  });
});

describe('firstOwnFrame', () => {
  it('salta marcos de framework', () => {
    expect(firstOwnFrame(parseException(EN).frames)).toBe('GCC.BL.Pagos.Aplicar(Int32 id)');
  });
  it('null si todo es framework', () => {
    expect(firstOwnFrame(['System.A.B()', 'lambda_method(Closure)'])).toBeNull();
  });
});

describe('computeErrorFingerprint', () => {
  const base = {
    clienteKey: '3',
    sistemaKey: '1',
    aplicativo: 'GCC',
    logger: 'GCC.BL.Pagos',
    mensaje: 'Pedido 100 falló',
    excepcion: EN as string | null,
  };
  it('misma excepción con otro pedido y otra línea -> misma huella', () => {
    const a = computeErrorFingerprint(base);
    const b = computeErrorFingerprint({
      ...base,
      mensaje: 'Pedido 999 falló',
      excepcion: EN.replace('line 42', 'line 77'),
    });
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
  it('otro cliente -> otra huella', () => {
    expect(computeErrorFingerprint({ ...base, clienteKey: '4' }).fingerprint).not.toBe(
      computeErrorFingerprint(base).fingerprint,
    );
  });
  it('sin excepción depende del mensaje normalizado y del logger', () => {
    const s = { ...base, excepcion: null };
    const a = computeErrorFingerprint(s);
    expect(computeErrorFingerprint({ ...s, mensaje: 'Pedido 5 falló' }).fingerprint).toBe(a.fingerprint);
    expect(computeErrorFingerprint({ ...s, logger: 'Otro' }).fingerprint).not.toBe(a.fingerprint);
    expect(computeErrorFingerprint({ ...s, mensaje: 'distinto' }).fingerprint).not.toBe(a.fingerprint);
  });
  it('title con tipo y primera línea del mensaje (≤ 200)', () => {
    const r = computeErrorFingerprint({ ...base, mensaje: 'x'.repeat(300) + '\nsegunda' });
    expect(r.exceptionType).toBe('System.NullReferenceException');
    expect(r.title).toBe('System.NullReferenceException: ' + 'x'.repeat(200));
  });
  it('title sin excepción es solo el mensaje', () => {
    expect(computeErrorFingerprint({ ...base, excepcion: null }).title).toBe('Pedido 100 falló');
  });
});
