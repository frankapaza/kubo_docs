import { serverAlertsFor, ServerAlertInput } from './server-alerts';

// 2026-11-24 15:00Z = 10:00 Lima.
const NOW = new Date('2026-11-24T15:00:00.000Z');
const GB = 1024 ** 3;
const base = (over: Partial<ServerAlertInput> = {}): ServerAlertInput => ({
  id: 1,
  name: 'srv-app',
  hasAgent: true,
  agentLastSeenAt: new Date(NOW.getTime() - 60_000),
  agentTokenCreatedAt: new Date('2026-11-01T00:00:00Z'),
  lastDisks: null,
  ...over,
});

describe('serverAlertsFor', () => {
  it('C: 9 % y D: 50 % -> un DISK_LOW de C: con «C: 9 % libre»', () => {
    const alerts = serverAlertsFor(
      [base({ lastDisks: [
        { name: 'C:', totalBytes: 100 * GB, freeBytes: 9 * GB },
        { name: 'D:', totalBytes: 100 * GB, freeBytes: 50 * GB },
      ] })],
      NOW,
    );
    expect(alerts).toEqual([{ serverId: 1, serverName: 'srv-app', kind: 'DISK_LOW', detail: 'C: 9 % libre' }]);
  });

  it('justo en 10 % no avisa; 9,9 % sí y redondea hacia abajo', () => {
    const at10 = serverAlertsFor([base({ lastDisks: [{ name: 'C:', totalBytes: 1000, freeBytes: 100 }] })], NOW);
    expect(at10).toEqual([]);
    const at99 = serverAlertsFor([base({ lastDisks: [{ name: 'C:', totalBytes: 1000, freeBytes: 99 }] })], NOW);
    expect(at99[0].detail).toBe('C: 9 % libre');
  });

  it('un disco con total 0 se ignora', () => {
    expect(serverAlertsFor([base({ lastDisks: [{ name: 'X:', totalBytes: 0, freeBytes: 0 }] })], NOW)).toEqual([]);
  });

  it('agente mudo -> AGENT_SILENT con la hora de Lima y sin DISK_LOW', () => {
    const alerts = serverAlertsFor(
      [base({
        agentLastSeenAt: new Date('2026-11-24T14:32:00.000Z'), // 09:32 Lima, hace 28 min
        lastDisks: [{ name: 'C:', totalBytes: 100, freeBytes: 1 }],
      })],
      NOW,
    );
    expect(alerts).toEqual([{ serverId: 1, serverName: 'srv-app', kind: 'AGENT_SILENT', detail: 'sin datos desde 09:32' }]);
  });

  it('silencio de otro día lleva la fecha', () => {
    const alerts = serverAlertsFor([base({ agentLastSeenAt: new Date('2026-11-22T19:05:00.000Z') })], NOW);
    expect(alerts[0].detail).toBe('sin datos desde 22/11 14:05');
  });

  it('10 min exactos no es silencio (debe pasar más)', () => {
    expect(serverAlertsFor([base({ agentLastSeenAt: new Date(NOW.getTime() - 600_000) })], NOW)).toEqual([]);
    expect(serverAlertsFor([base({ agentLastSeenAt: new Date(NOW.getTime() - 600_001) })], NOW)).toHaveLength(1);
  });

  it('nunca reportó: cuenta desde la emisión del token', () => {
    const fresh = base({ agentLastSeenAt: null, agentTokenCreatedAt: new Date(NOW.getTime() - 5 * 60_000) });
    expect(serverAlertsFor([fresh], NOW)).toEqual([]);
    const old = base({ agentLastSeenAt: null, agentTokenCreatedAt: new Date(NOW.getTime() - 30 * 60_000) });
    expect(serverAlertsFor([old], NOW)).toEqual([
      { serverId: 1, serverName: 'srv-app', kind: 'AGENT_SILENT', detail: 'sin datos desde 09:30' },
    ]);
  });

  it('un servidor sin token no da AGENT_SILENT ni DISK_LOW', () => {
    const alerts = serverAlertsFor(
      [base({ hasAgent: false, agentLastSeenAt: new Date('2026-01-01T00:00:00Z'), lastDisks: [{ name: 'C:', totalBytes: 100, freeBytes: 1 }] })],
      NOW,
    );
    expect(alerts).toEqual([]);
  });
});
