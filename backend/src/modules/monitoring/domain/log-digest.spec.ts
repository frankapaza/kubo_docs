import { LogDigest } from './log-digest';

const T0 = new Date('2026-11-27T10:00:00.000Z');
const T1 = new Date('2026-11-27T10:30:00.000Z');
const T2 = new Date('2026-11-27T11:00:00.000Z');

describe('LogDigest', () => {
  it('sin actividad ni orígenes callados no hay resumen', () => {
    const d = new LogDigest(T0);
    expect(d.flush(T1)).toBeNull();
  });

  it('cuenta por nivel y por origen, con los orígenes de más errores primero', () => {
    const d = new LogDigest(T0);
    d.record('Fidelity · Legal', 'Legal', 'SRV-1', ['INFO', 'INFO', 'WARN']);
    d.record('Cobros · Cobranza', 'CS-PRUEBA', 'PC-1', ['ERROR', 'FATAL', 'INFO']);
    d.record('Fidelity · Legal', 'Legal', 'SRV-1', ['ERROR']);

    const r = d.flush(T1)!;
    expect(r.desde).toBe(T0.toISOString());
    expect(r.hasta).toBe(T1.toISOString());
    expect(r.total).toBe(7);
    expect(r.porNivel).toEqual({ DEBUG: 0, INFO: 3, WARN: 1, ERROR: 2, FATAL: 1 });
    expect(r.fuentes.map((f) => [f.nombre, f.total, f.errores, f.avisos])).toEqual([
      ['Cobros · Cobranza · CS-PRUEBA (PC-1)', 3, 2, 0],
      ['Fidelity · Legal · Legal (SRV-1)', 4, 1, 1],
    ]);
    expect(r.callados).toEqual([]);
  });

  it('se vacía al cerrar la ventana y la siguiente empieza donde terminó', () => {
    const d = new LogDigest(T0);
    d.record('A', 'App', 'S', ['INFO']);
    d.flush(T1);
    d.record('A', 'App', 'S', ['WARN']);
    const r = d.flush(T2)!;
    expect(r.desde).toBe(T1.toISOString());
    expect(r.total).toBe(1);
    expect(r.porNivel.WARN).toBe(1);
  });

  it('avisa del origen que envió en la ventana anterior y en esta no', () => {
    const d = new LogDigest(T0);
    d.record('A', 'App', 'S1', ['INFO']);
    d.record('B', 'Otra', 'S2', ['INFO']);
    d.flush(T1);
    d.record('A', 'App', 'S1', ['INFO']);
    const r = d.flush(T2)!;
    expect(r.callados).toEqual(['B · Otra (S2)']);
  });

  it('un origen callado basta para que haya resumen, aunque no llegara nada', () => {
    const d = new LogDigest(T0);
    d.record('A', 'App', 'S1', ['INFO']);
    d.flush(T1);
    const r = d.flush(T2)!;
    expect(r.total).toBe(0);
    expect(r.callados).toEqual(['A · App (S1)']);
  });

  it('un origen callado se avisa una sola vez', () => {
    const d = new LogDigest(T0);
    d.record('A', 'App', 'S1', ['INFO']);
    d.flush(T1);
    d.flush(T2);
    expect(d.flush(new Date('2026-11-27T11:30:00.000Z'))).toBeNull();
  });

  it('lista como mucho 5 orígenes', () => {
    const d = new LogDigest(T0);
    for (let i = 0; i < 8; i++) d.record(`C${i}`, 'App', 'S', ['INFO']);
    const r = d.flush(T1)!;
    expect(r.fuentes).toHaveLength(5);
    expect(r.totalFuentes).toBe(8);
  });
});
