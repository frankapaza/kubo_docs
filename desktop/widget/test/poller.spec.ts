import { fetchAllEvents, normalizeCentralUrl, Poller } from '../src/main/poller';
import type { Toast } from '../src/shared/notify-policy';
import type { EngineEvent, EngineStatus } from '../src/shared/types';
import type { EngineReach } from '../src/shared/widget-model';

const T0 = Date.parse('2026-11-24T15:30:00Z');

function status(p: Partial<EngineStatus> = {}): EngineStatus {
  return {
    engine: { version: '0.1.0', startedAt: '2026-11-24T15:00:00Z' },
    centralUrl: 'https://central.example.com/',
    central: { reachable: true, lastSyncAt: null, consecutiveFailures: 0, rejecting: false },
    officeOutage: false, pending: 0, services: [], ...p,
  };
}

function ev(p: Partial<EngineEvent>): EngineEvent {
  return {
    id: 1, at: '2026-11-24T15:31:00Z', kind: 'INCIDENT_OPENED', incidentKey: 7, incidentKind: 'DOWN',
    serverName: 'srv-1', serviceNames: ['API'], criticality: 'HIGH', ticketCode: null, notify: true, ...p,
  };
}

class FakeStore {
  writes = 0;
  private c = 0;
  get cursor(): number { return this.c; }
  set cursor(v: number) { this.c = v; this.writes++; }
}

function setup(reach: EngineReach[], pages: Array<{ lastId: number; events: EngineEvent[] } | Error>, failOnModel = false) {
  const store = new FakeStore();
  const toasts: Array<{ t: Toast; central: string }> = [];
  const models: string[] = [];
  const calls: number[] = [];
  const errors: unknown[] = [];
  const client = {
    status: async () => reach.length > 1 ? reach.shift()! : reach[0],
    events: async (after: number) => {
      calls.push(after);
      const p = pages.length > 1 ? pages.shift()! : pages[0] ?? { lastId: after, events: [] };
      if (p instanceof Error) throw p;
      return p;
    },
  };
  const poller = new Poller({
    client, store, now: () => T0 + 60_000, startedAt: T0,
    notify: (t, central) => toasts.push({ t, central }),
    onModel: (m) => {
      if (failOnModel) throw new Error('render');
      models.push(m.headline);
    },
    log: (e) => errors.push(e),
  });
  return { poller, store, toasts, models, calls, errors };
}

describe('Poller.tick exception safety', () => {
  it('survives a throwing onModel, logs it and still reads events', async () => {
    const s = setup([{ kind: 'ok', status: status() }], [{ lastId: 3, events: [ev({ id: 3 })] }], true);
    await expect(s.poller.tick()).resolves.toBeUndefined();
    expect(s.errors).toHaveLength(1);
    expect(s.toasts).toHaveLength(1);
    expect(s.store.cursor).toBe(3);
  });
});

describe('normalizeCentralUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeCentralUrl('https://a.example.com///')).toBe('https://a.example.com');
    expect(normalizeCentralUrl('https://a.example.com')).toBe('https://a.example.com');
  });
});

describe('Poller.tick', () => {
  it('pushes the model, keeps the normalized central url and toasts new HIGH events', async () => {
    const s = setup([{ kind: 'ok', status: status() }], [{ lastId: 3, events: [ev({ id: 3 })] }]);
    await s.poller.tick();
    expect(s.models).toEqual(['KUBO · Todo operativo']);
    expect(s.poller.centralUrl).toBe('https://central.example.com');
    expect(s.toasts.map((x) => x.t.url)).toEqual(['https://central.example.com/monitoreo/incidentes/7']);
    expect(s.store.cursor).toBe(3);
  });

  it('writes the cursor only when it changes', async () => {
    const s = setup([{ kind: 'ok', status: status() }], [{ lastId: 0, events: [] }]);
    await s.poller.tick();
    await s.poller.tick();
    expect(s.store.writes).toBe(0);
  });

  it('survives events() failures', async () => {
    const s = setup([{ kind: 'ok', status: status() }], [new Error('boom')]);
    await expect(s.poller.tick()).resolves.toBeUndefined();
    expect(s.models).toHaveLength(1);
    expect(s.toasts).toEqual([]);
  });

  it('does not read events while the engine is down', async () => {
    const s = setup([{ kind: 'down' }], [{ lastId: 1, events: [ev({})] }]);
    await s.poller.tick();
    expect(s.calls).toEqual([]);
    expect(s.models).toEqual(['El motor no responde']);
  });

  it('toasts engine down once after 3 consecutive down following ok', async () => {
    const s = setup([{ kind: 'ok', status: status() }, { kind: 'down' }, { kind: 'down' }, { kind: 'down' }], [{ lastId: 0, events: [] }]);
    await s.poller.tick();
    await s.poller.tick();
    await s.poller.tick();
    expect(s.toasts).toEqual([]);
    await s.poller.tick();
    await s.poller.tick();
    expect(s.toasts.map((x) => x.t.title)).toEqual(['El motor no responde']);
    expect(s.toasts[0].central).toBe('https://central.example.com');
  });

  it('keeps paging while pages are full', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ev({ id: i + 1, notify: false }));
    const s = setup([{ kind: 'ok', status: status() }], [{ lastId: 101, events: full }, { lastId: 101, events: [ev({ id: 101, notify: false })] }]);
    await s.poller.tick();
    expect(s.calls).toEqual([0, 100]);
    expect(s.store.cursor).toBe(101);
  });
});

describe('fetchAllEvents', () => {
  it('pages from 0 until a short page', async () => {
    const calls: number[] = [];
    const client = {
      events: async (after: number, limit = 100) => {
        calls.push(after);
        const n = after === 0 ? limit : 2;
        return { lastId: 0, events: Array.from({ length: n }, (_, i) => ev({ id: after + i + 1 })) };
      },
    };
    const all = await fetchAllEvents(client, 3);
    expect(calls).toEqual([0, 3]);
    expect(all.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('stops after the page cap', async () => {
    let n = 0;
    const client = { events: async (after: number, limit = 100) => { n++; return { lastId: 0, events: Array.from({ length: limit }, (_, i) => ev({ id: after + i + 1 })) }; } };
    await fetchAllEvents(client, 500);
    expect(n).toBe(11);
  });
});
