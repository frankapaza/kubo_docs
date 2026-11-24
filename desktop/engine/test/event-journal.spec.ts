import Database from 'better-sqlite3';
import { EVENTS_MAX_ROWS, EventJournal } from '../src/events/event-journal';
import type { EngineEvent } from '../src/events/diff-states';

const ev = (at: string, over: Partial<EngineEvent> = {}): Omit<EngineEvent, 'id'> => ({
  at,
  kind: 'CENTRAL_UNREACHABLE',
  incidentKey: null,
  incidentKind: null,
  serverName: null,
  serviceNames: [],
  criticality: null,
  ticketCode: null,
  notify: true,
  ...over,
});

describe('EventJournal', () => {
  let db: Database.Database;
  let j: EventJournal;

  beforeEach(() => {
    db = new Database(':memory:');
    j = new EventJournal(db);
  });
  afterEach(() => db.close());

  it('append devuelve ids crecientes y el evento completo; lastId es el último', () => {
    expect(j.lastId()).toBe(0);
    const a = j.append(ev('2026-11-24T10:00:00.000Z'));
    const b = j.append(
      ev('2026-11-24T10:01:00.000Z', {
        kind: 'INCIDENT_OPENED',
        incidentKey: 9,
        incidentKind: 'DOWN',
        serverName: 'srv',
        serviceNames: ['a', 'b'],
        criticality: 'HIGH',
        ticketCode: 'KT-1',
      }),
    );
    expect(b.id).toBeGreaterThan(a.id);
    expect(j.lastId()).toBe(b.id);
    expect(j.after(a.id, 10)).toEqual([b]);
    expect(b).toEqual({
      id: b.id,
      at: '2026-11-24T10:01:00.000Z',
      kind: 'INCIDENT_OPENED',
      incidentKey: 9,
      incidentKind: 'DOWN',
      serverName: 'srv',
      serviceNames: ['a', 'b'],
      criticality: 'HIGH',
      ticketCode: 'KT-1',
      notify: true,
    });
  });

  it('after(id, n) ordena por id y limita', () => {
    const ids = Array.from({ length: 5 }, (_, i) => j.append(ev(`2026-11-24T10:0${i}:00.000Z`, { notify: i % 2 === 0 })).id);
    expect(j.after(0, 3).map((e) => e.id)).toEqual(ids.slice(0, 3));
    expect(j.after(ids[1], 10).map((e) => e.id)).toEqual(ids.slice(2));
    expect(j.after(ids[4], 10)).toEqual([]);
    expect(j.after(0, 10).map((e) => e.notify)).toEqual([true, false, true, false, true]);
  });

  it('retención por filas: se conservan las últimas EVENTS_MAX_ROWS', () => {
    const insert = db.transaction(() => {
      for (let i = 0; i < EVENTS_MAX_ROWS + 3; i++) j.append(ev('2026-11-24T10:00:00.000Z'));
    });
    insert();
    const n = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
    expect(n).toBe(EVENTS_MAX_ROWS);
    expect(j.after(0, 1)[0].id).toBe(4);
    expect(j.lastId()).toBe(EVENTS_MAX_ROWS + 3);
  });

  it('retención por edad: se borra lo de más de 30 días', () => {
    j.append(ev('2026-10-01T00:00:00.000Z'));
    const keep = j.append(ev('2026-10-30T00:00:00.000Z'));
    const last = j.append(ev('2026-11-24T10:00:00.000Z'));
    expect(j.after(0, 10).map((e) => e.id)).toEqual([keep.id, last.id]);
  });
});
