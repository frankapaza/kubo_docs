import type Database from 'better-sqlite3';
import type { EngineEvent, EngineEventKind } from './diff-states';

/** Retención del diario: lo que se alcance primero. */
export const EVENTS_MAX_ROWS = 5000;
export const EVENTS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const EVENTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    at            TEXT NOT NULL,
    kind          TEXT NOT NULL,
    incident_key  INTEGER,
    incident_kind TEXT,
    server_name   TEXT,
    service_names TEXT NOT NULL,
    criticality   TEXT,
    ticket_code   TEXT,
    notify        INTEGER NOT NULL,
    server_id     INTEGER,
    alert_kind    TEXT,
    detail        TEXT
  );
`;

/** Columnas añadidas después de la primera versión: una base existente se amplía al abrirla. */
const ADDED_COLUMNS: [string, string][] = [
  ['server_id', 'INTEGER'],
  ['alert_kind', 'TEXT'],
  ['detail', 'TEXT'],
];

interface Row {
  id: number;
  at: string;
  kind: EngineEventKind;
  incident_key: number | null;
  incident_kind: EngineEvent['incidentKind'];
  server_name: string | null;
  service_names: string;
  criticality: EngineEvent['criticality'];
  ticket_code: string | null;
  notify: number;
  server_id: number | null;
  alert_kind: EngineEvent['alertKind'];
  detail: string | null;
}

const toEvent = (r: Row): EngineEvent => ({
  id: r.id,
  at: r.at,
  kind: r.kind,
  incidentKey: r.incident_key,
  incidentKind: r.incident_kind,
  serverName: r.server_name,
  serviceNames: JSON.parse(r.service_names) as string[],
  criticality: r.criticality,
  ticketCode: r.ticket_code,
  serverId: r.server_id ?? null,
  alertKind: r.alert_kind ?? null,
  detail: r.detail ?? null,
  notify: r.notify === 1,
});

/**
 * Diario de eventos del motor (tabla `events` en la misma base que el Outbox).
 * Los ids son AUTOINCREMENT: nunca se reutilizan aunque la retención borre filas,
 * así el widget puede pedir «después de» el último que vio.
 */
export class EventJournal {
  private readonly insertStmt: Database.Statement;
  private readonly pruneRowsStmt: Database.Statement;
  private readonly pruneAgeStmt: Database.Statement;
  private readonly afterStmt: Database.Statement;
  private readonly lastIdStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    db.exec(EVENTS_TABLE_SQL);
    const have = new Set((db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).map((c) => c.name));
    for (const [name, type] of ADDED_COLUMNS) if (!have.has(name)) db.exec(`ALTER TABLE events ADD COLUMN ${name} ${type}`);
    this.insertStmt = db.prepare(
      `INSERT INTO events (at, kind, incident_key, incident_kind, server_name, service_names, criticality, ticket_code, notify, server_id, alert_kind, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.pruneRowsStmt = db.prepare('DELETE FROM events WHERE id <= ? - ?');
    this.pruneAgeStmt = db.prepare('DELETE FROM events WHERE at < ?');
    this.afterStmt = db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?');
    // sqlite_sequence conserva el último id aunque la retención haya borrado la fila.
    this.lastIdStmt = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'events'");
  }

  append(e: Omit<EngineEvent, 'id'>): EngineEvent {
    return this.db.transaction(() => {
      const res = this.insertStmt.run(
        e.at,
        e.kind,
        e.incidentKey,
        e.incidentKind,
        e.serverName,
        JSON.stringify(e.serviceNames),
        e.criticality,
        e.ticketCode,
        e.notify ? 1 : 0,
        e.serverId,
        e.alertKind,
        e.detail,
      );
      const id = Number(res.lastInsertRowid);
      this.pruneRowsStmt.run(id, EVENTS_MAX_ROWS);
      const t = Date.parse(e.at);
      if (Number.isFinite(t)) this.pruneAgeStmt.run(new Date(t - EVENTS_MAX_AGE_MS).toISOString());
      return { ...e, serviceNames: [...e.serviceNames], id };
    })();
  }

  after(afterId: number, limit: number): EngineEvent[] {
    return (this.afterStmt.all(afterId, Math.max(0, limit)) as Row[]).map(toEvent);
  }

  lastId(): number {
    const row = this.lastIdStmt.get() as { seq: number } | undefined;
    return row ? Number(row.seq) : 0;
  }
}
