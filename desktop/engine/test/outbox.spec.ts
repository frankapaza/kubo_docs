import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CheckResult, ProbeSignal } from '@kubo/monitoring-core';
import { Outbox } from '../src/outbox';

const check = (over: Partial<CheckResult> = {}): CheckResult => ({
  id: randomUUID(),
  serviceId: 1,
  kind: 'REGULAR',
  cycleAt: '2026-11-23T15:00:37.000Z',
  startedAt: '2026-11-23T15:00:37.000Z',
  durationMs: 12,
  ok: true,
  errorCode: null,
  httpStatus: null,
  orderId: null,
  ...over,
});

const signal = (over: Partial<ProbeSignal> = {}): ProbeSignal => ({
  id: randomUUID(),
  type: 'VERIFYING',
  serviceId: 1,
  at: '2026-11-23T15:00:37.000Z',
  firstFailureAt: '2026-11-23T15:00:37.000Z',
  ...over,
});

describe('Outbox', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kubo-outbox-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('encolar, peek, ack → pendingCount 0', () => {
    const ob = new Outbox(join(dir, 'engine.db'));
    const c1 = check();
    const s1 = signal();
    const c2 = check({ ok: false });
    ob.enqueueCheck(c1);
    ob.enqueueSignal(s1);
    ob.enqueueCheck(c2);
    expect(ob.pendingCount()).toBe(3);

    const batch = ob.peekBatch(500);
    expect(batch.checks).toEqual([c1, c2]);
    expect(batch.signals).toEqual([s1]);

    ob.ack(batch.checks.map((c) => c.id), batch.signals.map((s) => s.id));
    expect(ob.pendingCount()).toBe(0);
    expect(ob.peekBatch(500)).toEqual({ checks: [], signals: [] });
    ob.close();
  });

  it('el lote es un prefijo en orden de inserción: no adelanta una señal posterior', () => {
    const ob = new Outbox(':memory:');
    const s1 = signal();
    const c1 = check();
    const c2 = check();
    const s2 = signal({ type: 'CONFIRMED_FAILURE' });
    for (const x of [s1, c1, c2, s2]) 'type' in x ? ob.enqueueSignal(x) : ob.enqueueCheck(x);

    // Tope de 1 check: corta en c2 y no incluye s2, que es posterior.
    expect(ob.peekBatch(1, 200)).toEqual({ checks: [c1], signals: [s1] });
    // Tope de 1 señal: corta en s2.
    expect(ob.peekBatch(500, 1)).toEqual({ checks: [c1, c2], signals: [s1] });
    expect(ob.peekBatch(500, 200)).toEqual({ checks: [c1, c2], signals: [s1, s2] });
    ob.close();
  });

  it('reabrir la base conserva lo pendiente', () => {
    const file = join(dir, 'engine.db');
    const ob = new Outbox(file);
    const c1 = check();
    const s1 = signal();
    ob.enqueueCheck(c1);
    ob.enqueueSignal(s1);
    ob.saveConfig('v1', '{"services":[]}');
    ob.close();

    const again = new Outbox(file);
    expect(again.pendingCount()).toBe(2);
    expect(again.peekBatch(500)).toEqual({ checks: [c1], signals: [s1] });
    expect(again.loadConfig()).toEqual({ version: 'v1', json: '{"services":[]}' });
    again.close();
  });

  it('ack de ids desconocidos no falla', () => {
    const ob = new Outbox(':memory:');
    const c1 = check();
    ob.enqueueCheck(c1);
    expect(() => ob.ack([randomUUID(), 'no-existe'], [randomUUID()])).not.toThrow();
    expect(ob.pendingCount()).toBe(1);
    ob.close();
  });

  it('encolar dos veces el mismo id no lo duplica', () => {
    const ob = new Outbox(':memory:');
    const c1 = check();
    ob.enqueueCheck(c1);
    ob.enqueueCheck(c1);
    expect(ob.pendingCount()).toBe(1);
    ob.close();
  });

  it('saveState guarda el último estado combinado y sobrevive a reabrir', () => {
    const file = join(dir, 'engine.db');
    const ob = new Outbox(file);
    expect(ob.loadState()).toBeNull();
    ob.saveState('[1]');
    ob.saveState('[2]');
    ob.close();
    const again = new Outbox(file);
    expect(again.loadState()).toBe('[2]');
    again.close();
  });

  it('saveConfig reemplaza la anterior; sin config devuelve null', () => {
    const ob = new Outbox(':memory:');
    expect(ob.loadConfig()).toBeNull();
    ob.saveConfig('v1', 'a');
    ob.saveConfig('v2', 'b');
    expect(ob.loadConfig()).toEqual({ version: 'v2', json: 'b' });
    ob.close();
  });
});
