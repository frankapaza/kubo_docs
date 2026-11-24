import Database from 'better-sqlite3';
import type { CheckResult, ProbeSignal } from '@kubo/monitoring-core';

type Kind = 'CHECK' | 'SIGNAL';

/**
 * Cola de envío persistente (SQLite) y última configuración conocida.
 *
 * Checks y señales comparten una sola tabla con una secuencia autoincremental:
 * `peekBatch` devuelve siempre un PREFIJO de la cola en orden de inserción, de
 * modo que nunca sale una señal (ni un check) antes que otro anterior. Lo que
 * se escribe aquí sobrevive a un reinicio: el motor encola en `onResult`, antes
 * de devolver el control al `ProbeRunner`.
 */
export class Outbox {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;

  constructor(file: string) {
    this.db = new Database(file);
    if (file !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outbox (
        seq     INTEGER PRIMARY KEY AUTOINCREMENT,
        kind    TEXT NOT NULL CHECK (kind IN ('CHECK', 'SIGNAL')),
        id      TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE (kind, id)
      );
      CREATE TABLE IF NOT EXISTS config (
        k       INTEGER PRIMARY KEY CHECK (k = 1),
        version TEXT NOT NULL,
        json    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kv (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );
    `);
    this.insertStmt = this.db.prepare('INSERT OR IGNORE INTO outbox (kind, id, payload) VALUES (?, ?, ?)');
    this.deleteStmt = this.db.prepare('DELETE FROM outbox WHERE kind = ? AND id = ?');
  }

  enqueueCheck(r: CheckResult): void {
    this.insertStmt.run('CHECK', r.id, JSON.stringify(r));
  }

  enqueueSignal(s: ProbeSignal): void {
    this.insertStmt.run('SIGNAL', s.id, JSON.stringify(s));
  }

  /** Un resultado y sus señales, en una sola transacción y en ese orden. */
  enqueueResult(r: CheckResult, signals: ProbeSignal[]): void {
    this.db.transaction(() => {
      this.enqueueCheck(r);
      for (const s of signals) this.enqueueSignal(s);
    })();
  }

  /**
   * El prefijo más largo de la cola con como mucho `max` checks y `maxSignals`
   * señales (por defecto también `max`), en orden de inserción. Se corta en el
   * primer elemento que no cabe, para no adelantar los posteriores.
   */
  peekBatch(max: number, maxSignals: number = max): { checks: CheckResult[]; signals: ProbeSignal[] } {
    const checks: CheckResult[] = [];
    const signals: ProbeSignal[] = [];
    const rows = this.db
      .prepare('SELECT kind, payload FROM outbox ORDER BY seq LIMIT ?')
      .all(Math.max(0, max) + Math.max(0, maxSignals)) as { kind: Kind; payload: string }[];
    for (const row of rows) {
      if (row.kind === 'CHECK') {
        if (checks.length >= max) break;
        checks.push(JSON.parse(row.payload) as CheckResult);
      } else {
        if (signals.length >= maxSignals) break;
        signals.push(JSON.parse(row.payload) as ProbeSignal);
      }
    }
    return { checks, signals };
  }

  ack(checkIds: string[], signalIds: string[]): void {
    this.db.transaction(() => {
      for (const id of checkIds) this.deleteStmt.run('CHECK', id);
      for (const id of signalIds) this.deleteStmt.run('SIGNAL', id);
    })();
  }

  saveConfig(version: string, json: string): void {
    this.db
      .prepare('INSERT INTO config (k, version, json) VALUES (1, ?, ?) ON CONFLICT(k) DO UPDATE SET version = excluded.version, json = excluded.json')
      .run(version, json);
  }

  loadConfig(): { version: string; json: string } | null {
    const row = this.db.prepare('SELECT version, json FROM config WHERE k = 1').get() as { version: string; json: string } | undefined;
    return row ? { version: row.version, json: row.json } : null;
  }

  /** Último estado combinado recibido (JSON): el widget lo ve aunque se reinicie sin red. */
  saveState(json: string): void {
    this.db.prepare("INSERT INTO kv (k, v) VALUES ('state', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(json);
  }

  loadState(): string | null {
    const row = this.db.prepare("SELECT v FROM kv WHERE k = 'state'").get() as { v: string } | undefined;
    return row ? row.v : null;
  }

  pendingCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM outbox').get() as { n: number }).n;
  }

  close(): void {
    if (this.db.open) this.db.close();
  }
}
