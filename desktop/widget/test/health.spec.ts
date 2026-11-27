import { enginePort } from '../src/main/engine-port';
import { healthFrom } from '../src/shared/health';
import type { EngineStatus } from '../src/shared/types';

const STATUS: EngineStatus = {
  engine: { version: '0.3.1', startedAt: '2026-11-24T15:00:00Z' },
  centralUrl: 'https://central.example.com',
  central: { reachable: false, lastSyncAt: '2026-11-24T15:20:00Z', consecutiveFailures: 4, rejecting: true },
  officeOutage: false, pending: 37, services: [],
};

describe('healthFrom', () => {
  it('lists engine version, central, last sync (Lima), pending and rejecting', () => {
    expect(healthFrom({ kind: 'ok', status: STATUS })).toEqual([
      ['Motor', 'Activo · versión 0.3.1'],
      ['Central', 'No alcanzable'],
      ['Último sync', '10:20'],
      ['Pendientes de envío', '37'],
      ['Envíos rechazados', 'Sí'],
    ]);
  });

  it('explains when the engine cannot be read', () => {
    expect(healthFrom({ kind: 'down' })[0]).toEqual(['Motor', 'No responde']);
    expect(healthFrom({ kind: 'forbidden' })[0]).toEqual(['Motor', 'Sin permiso para leer el secreto local']);
    expect(healthFrom({ kind: 'connecting' })).toHaveLength(1);
  });

  it('shows a dash without a last sync', () => {
    const rows = healthFrom({ kind: 'ok', status: { ...STATUS, central: { ...STATUS.central, lastSyncAt: null, reachable: true, rejecting: false } } });
    expect(rows).toContainEqual(['Último sync', '—']);
    expect(rows).toContainEqual(['Central', 'Alcanzable']);
    expect(rows).toContainEqual(['Envíos rechazados', 'No']);
  });
});

describe('enginePort', () => {
  it('prefers KUBO_MONITOR_PORT, then engine.json, then 47800', () => {
    const read = (json: string) => () => json;
    const none = () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); };
    expect(enginePort('h', { KUBO_MONITOR_PORT: '48001' }, read('{"localPort":1}'))).toBe(48001);
    expect(enginePort('h', {}, read('{"localPort":47999}'))).toBe(47999);
    expect(enginePort('h', {}, none)).toBe(47800);
    expect(enginePort('h', { KUBO_MONITOR_PORT: 'abc' }, read('{"localPort":0}'))).toBe(47800);
  });
});
