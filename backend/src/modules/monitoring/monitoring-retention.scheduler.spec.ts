import { DataSource } from 'typeorm';

import { MonitoringRetentionScheduler } from './monitoring-retention.scheduler';

/**
 * Doble de `DataSource.query`. Sin reloj ni zona del proceso: `now` se pasa a
 * mano y todo se compara en UTC.
 */
function build() {
  const dsMock = { query: jest.fn(async (_sql: string, _params: unknown[] = []) => ({ affectedRows: 0 }) as unknown) };
  const scheduler = new MonitoringRetentionScheduler(dsMock as unknown as DataSource);
  return { scheduler, dsMock };
}

describe('MonitoringRetentionScheduler.purge', () => {
  const now = new Date('2026-11-07T03:30:00.000Z');
  const cutoff = new Date('2026-05-11T03:30:00.000Z'); // 180 días antes

  it('borra ocurrencias y días con más de 180 días, en tandas de 5000, hasta vaciar', async () => {
    const { scheduler, dsMock } = build();
    const occ = [5000, 5000, 12];
    const daily = [7];
    dsMock.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE FROM error_occurrences WHERE occurred_at')) return { affectedRows: occ.shift() ?? 0 };
      if (sql.startsWith('DELETE FROM error_group_daily WHERE day')) return { affectedRows: daily.shift() ?? 0 };
      if (sql.startsWith('SELECT id FROM error_groups')) return [];
      return { affectedRows: 0 };
    });

    const res = await scheduler.purge(now);

    expect(res).toEqual({ occurrences: 10012, daily: 7, groups: 0 });
    const occCalls = dsMock.query.mock.calls.filter(([s]) => s.startsWith('DELETE FROM error_occurrences WHERE occurred_at'));
    expect(occCalls).toHaveLength(3); // 5000, 5000 y 12 (<5000 corta)
    expect(occCalls[0][1]).toEqual([cutoff, 5000]);
    const dailyCall = dsMock.query.mock.calls.find(([s]) => s.startsWith('DELETE FROM error_group_daily WHERE day'));
    expect(dailyCall![1]).toEqual(['2026-05-11', 5000]);
  });

  it('borra los grupos sin ticket no vistos en 180 días con sus ocurrencias y días, antes que el grupo', async () => {
    const { scheduler, dsMock } = build();
    const order: string[] = [];
    let selected = false;
    dsMock.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SELECT id FROM error_groups')) {
        expect(sql).toContain('ticket_id IS NULL');
        expect(sql).toContain('last_seen_at < ?');
        expect(params[0]).toEqual(cutoff);
        if (selected) return [];
        selected = true;
        return [{ id: '11' }, { id: '12' }];
      }
      if (sql.startsWith('DELETE FROM error_occurrences WHERE group_id IN')) {
        order.push('occ');
        expect(params).toEqual(['11', '12']);
        return { affectedRows: 4 };
      }
      if (sql.startsWith('DELETE FROM error_group_daily WHERE group_id IN')) {
        order.push('daily');
        return { affectedRows: 9 };
      }
      if (sql.startsWith('DELETE FROM error_groups WHERE id IN')) {
        order.push('groups');
        expect(sql).toContain('ticket_id IS NULL');
        return { affectedRows: 2 };
      }
      return { affectedRows: 0 };
    });

    const res = await scheduler.purge(now);

    expect(order).toEqual(['occ', 'daily', 'groups']);
    expect(res).toEqual({ occurrences: 4, daily: 9, groups: 2 });
  });

  it('nunca selecciona grupos con ticket_id', async () => {
    const { scheduler, dsMock } = build();
    dsMock.query.mockImplementation(async (sql: string) => (sql.startsWith('SELECT') ? [] : { affectedRows: 0 }));
    await scheduler.purge(now);
    const sel = dsMock.query.mock.calls.find(([s]) => s.startsWith('SELECT id FROM error_groups'))!;
    expect(sel[0]).toMatch(/ticket_id IS NULL/);
  });
});
