import { AvailabilityPurgeService } from './availability-purge.service';

// El doble de repositorio responde a `query` (DELETE ... LIMIT) con el afectado de cada lote.
const repo = (table: string, batches: number[] = []) =>
  ({
    metadata: { tableName: table },
    query: jest.fn().mockImplementation(async () => ({ affectedRows: batches.shift() ?? 0 })),
  }) as any;

type Repos = Partial<
  Record<
    'checks' | 'signals' | 'rollups' | 'rollupDays' | 'gaps' | 'reports' | 'incidents' | 'events' | 'evidence' | 'agentSamples' | 'agentRollups',
    any
  >
>;

function make(r: Repos = {}, storage: any = { remove: jest.fn().mockResolvedValue(undefined) }) {
  const all = {
    checks: r.checks ?? repo('monitor_checks'),
    signals: r.signals ?? repo('monitor_probe_signals'),
    rollups: r.rollups ?? repo('monitor_daily_rollups'),
    rollupDays: r.rollupDays ?? repo('monitor_rollup_days'),
    gaps: r.gaps ?? repo('monitor_probe_gaps'),
    reports: r.reports ?? repo('monitor_monthly_reports'),
    incidents: r.incidents ?? { metadata: { tableName: 'monitor_incidents' }, query: jest.fn().mockResolvedValue([]) },
    events: r.events ?? repo('monitor_incident_events'),
    evidence: r.evidence ?? { metadata: { tableName: 'monitor_evidence' }, query: jest.fn().mockResolvedValue([]) },
    agentSamples: r.agentSamples ?? repo('monitor_agent_samples'),
    agentRollups: r.agentRollups ?? repo('monitor_agent_daily_rollups'),
  };
  const svc = new AvailabilityPurgeService(
    all.checks,
    all.signals,
    all.rollups,
    all.rollupDays,
    all.gaps,
    all.reports,
    all.incidents,
    all.events,
    all.evidence,
    all.agentSamples,
    all.agentRollups,
    storage,
  );
  return { svc, ...all, storage };
}

/** Tabla en memoria que entiende `DELETE FROM t WHERE col < ? LIMIT 5000`. */
function tableRepo(table: string, col: string, values: string[]) {
  const rows = [...values];
  return {
    rows,
    metadata: { tableName: table },
    query: jest.fn().mockImplementation(async (sql: string, [cut]: [string]) => {
      expect(sql).toBe(`DELETE FROM \`${table}\` WHERE ${col} < ? LIMIT 5000`);
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i] < cut) rows.splice(i, 1);
      return { affectedRows: before - rows.length };
    }),
  };
}

describe('AvailabilityPurgeService', () => {
  it('borra en lotes de 5000 hasta que un lote devuelve menos (5000, 5000, 12 → 3 lotes)', async () => {
    const { svc, checks } = make({ checks: repo('monitor_checks', [5000, 5000, 12]) });
    const r = await svc.purge(new Date('2026-06-01T00:00:00Z'));
    expect(checks.query).toHaveBeenCalledTimes(3);
    expect(checks.query.mock.calls[0][0]).toBe('DELETE FROM `monitor_checks` WHERE started_at < ? LIMIT 5000');
    expect(r).toMatchObject({ checks: 10012, signals: 0 });
  });

  it('corta en el primer lote vacío y purga también las señales procesadas', async () => {
    const { svc, checks, signals } = make({
      checks: repo('monitor_checks', [0]),
      signals: repo('monitor_probe_signals', [5000, 3]),
    });
    const r = await svc.purge(new Date());
    expect(checks.query).toHaveBeenCalledTimes(1);
    expect(signals.query).toHaveBeenCalledTimes(2);
    expect(signals.query.mock.calls[0][0]).toBe(
      'DELETE FROM `monitor_probe_signals` WHERE processed_at IS NOT NULL AND processed_at < ? LIMIT 5000',
    );
    expect(r).toMatchObject({ checks: 0, signals: 5003 });
  });

  it('el límite de antigüedad es now - 90 días', async () => {
    const { svc, checks } = make();
    await svc.purge(new Date('2026-06-01T00:00:00Z'));
    expect((checks.query.mock.calls[0][1][0] as Date).toISOString()).toBe('2026-03-03T00:00:00.000Z');
  });

  it('borra las muestras del agente de más de 30 días y deja las de 29', async () => {
    // Tabla en memoria de instantes: `DELETE ... WHERE at < ?` con el corte que recibe.
    const NOW = new Date('2026-06-01T12:00:00Z');
    const ats = [31, 30.01, 29.99, 1].map((d) => new Date(NOW.getTime() - d * 86_400_000));
    const rows = [...ats];
    const agentSamples = {
      metadata: { tableName: 'monitor_agent_samples' },
      query: jest.fn().mockImplementation(async (sql: string, [cut]: [Date]) => {
        expect(sql).toBe('DELETE FROM `monitor_agent_samples` WHERE at < ? LIMIT 5000');
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i] < cut) rows.splice(i, 1);
        return { affectedRows: before - rows.length };
      }),
    };
    const { svc } = make({ agentSamples });
    const r = await svc.purge(NOW);
    expect(rows).toEqual(ats.slice(2));
    expect(r).toMatchObject({ agentSamples: 2 });
    expect((agentSamples.query.mock.calls[0][1][0] as Date).toISOString()).toBe('2026-05-02T12:00:00.000Z');
  });

  it('la tarea programada no lanza si la base falla', async () => {
    const c = repo('monitor_checks');
    c.query.mockRejectedValue(new Error('db'));
    const { svc } = make({ checks: c });
    await expect(svc.run()).resolves.toBeUndefined();
  });

  describe('retención de 12 meses (365 días)', () => {
    // now = 2026-06-01 12:00 Lima → corte 2025-06-01.
    const NOW = new Date('2026-06-01T17:00:00Z');

    it('borra resúmenes, días resumidos y huecos de más de 12 meses y deja los de 11', async () => {
      const dates = ['2025-05-01', '2025-05-31', '2025-06-01', '2025-07-01', '2026-05-31'];
      const rollups = tableRepo('monitor_daily_rollups', 'date', dates);
      const rollupDays = tableRepo('monitor_rollup_days', 'date', dates);
      const gaps = tableRepo('monitor_probe_gaps', 'date', dates);
      const { svc } = make({ rollups, rollupDays, gaps });
      const r = await svc.purge(NOW);
      for (const t of [rollups, rollupDays, gaps]) expect(t.rows).toEqual(['2025-06-01', '2025-07-01', '2026-05-31']);
      expect(r).toMatchObject({ rollups: 2, rollupDays: 2, gaps: 2 });
    });

    it('borra los resúmenes diarios del agente de más de 12 meses', async () => {
      const agentRollups = tableRepo('monitor_agent_daily_rollups', 'date', ['2025-05-31', '2025-06-01']);
      const { svc } = make({ agentRollups });
      const r = await svc.purge(NOW);
      expect(agentRollups.rows).toEqual(['2025-06-01']);
      expect(r).toMatchObject({ agentRollups: 1 });
    });

    it('borra informes mensuales de meses anteriores al mes de corte', async () => {
      const reports = tableRepo('monitor_monthly_reports', 'month', ['2025-04', '2025-05', '2025-06', '2025-07']);
      const { svc } = make({ reports });
      const r = await svc.purge(NOW);
      expect(reports.rows).toEqual(['2025-06', '2025-07']);
      expect(r).toMatchObject({ reports: 2 });
    });

    it('incidentes recuperados hace más de 12 meses: evidencia (archivo y fila), eventos, hijos y padres; nunca tickets', async () => {
      const log: string[] = [];
      const selects = [[{ id: 5 }, { id: 6 }], [{ id: 1 }], []];
      const incidents = {
        metadata: { tableName: 'monitor_incidents' },
        query: jest.fn().mockImplementation(async (sql: string) => {
          log.push(sql);
          return sql.startsWith('SELECT') ? selects.shift() : { affectedRows: 1 };
        }),
      };
      const evidence = {
        metadata: { tableName: 'monitor_evidence' },
        query: jest.fn().mockImplementation(async (sql: string, params: number[]) => {
          log.push(sql);
          if (sql.startsWith('SELECT')) return params.includes(5) ? [{ storageKey: 'a/5.png' }, { storageKey: 'a/5b.png' }] : [];
          return { affectedRows: 0 };
        }),
      };
      const events = {
        metadata: { tableName: 'monitor_incident_events' },
        query: jest.fn().mockImplementation(async (sql: string) => {
          log.push(sql);
          return { affectedRows: 3 };
        }),
      };
      const storage = {
        remove: jest.fn().mockImplementation(async (k: string) => {
          log.push(`REMOVE ${k}`);
          if (k === 'a/5b.png') throw new Error('ENOENT');
        }),
      };
      const { svc } = make({ incidents, evidence, events }, storage);
      const r = await svc.purge(NOW);

      // El SELECT usa el corte de 365 días, saca primero los hijos y excluye padres con hijos todavía presentes.
      const [sql, params] = incidents.query.mock.calls[0];
      expect(sql).toContain('i.recovered_at IS NOT NULL AND i.recovered_at < ?');
      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('ORDER BY i.parent_id IS NULL, i.id');
      expect((params[0] as Date).toISOString()).toBe('2025-06-01T17:00:00.000Z');

      expect(log.slice(1, 8)).toEqual([
        'SELECT storage_key AS storageKey FROM monitor_evidence WHERE incident_id IN (?,?)',
        'REMOVE a/5.png',
        'REMOVE a/5b.png', // un archivo que falla no frena la purga
        'DELETE FROM monitor_evidence WHERE incident_id IN (?,?)',
        'DELETE FROM monitor_incident_events WHERE incident_id IN (?,?)',
        'DELETE FROM monitor_incidents WHERE id IN (?,?) AND parent_id IS NOT NULL',
        'DELETE FROM monitor_incidents WHERE id IN (?,?)',
      ]);
      expect(r).toMatchObject({ incidents: 3 });
      expect(log.some((s) => /ticket/i.test(s))).toBe(false);
    });

    it('no entra en bucle si el SELECT devuelve otra vez ids ya borrados', async () => {
      const incidents = {
        metadata: { tableName: 'monitor_incidents' },
        query: jest.fn().mockImplementation(async (sql: string) => (sql.startsWith('SELECT') ? [{ id: 7 }] : { affectedRows: 0 })),
      };
      const { svc } = make({ incidents });
      await expect(svc.purge(NOW)).resolves.toMatchObject({ incidents: 1 });
    });
  });
});
