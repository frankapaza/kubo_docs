import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { MonitorAgentDailyRollup } from './monitor-agent-daily-rollup.entity';
import { MonitorAgentSample } from './monitor-agent-sample.entity';
import { MonitorDailyRollup } from './monitor-daily-rollup.entity';
import { MonitorEvidence } from './monitor-evidence.entity';
import { MonitorMaintenance } from './monitor-maintenance.entity';
import { MonitorMonthlyReport } from './monitor-monthly-report.entity';
import { MonitorProbeGap } from './monitor-probe-gap.entity';
import { MonitorRollupDay } from './monitor-rollup-day.entity';
import { MonitorCheck } from './monitor-check.entity';
import { MonitorIncident } from './monitor-incident.entity';
import { MonitorIncidentEvent } from './monitor-incident-event.entity';
import { MonitorOfficeOutage } from './monitor-office-outage.entity';
import { MonitorProbe } from './monitor-probe.entity';
import { MonitorProbeOrder } from './monitor-probe-order.entity';
import { MonitorProbeSignal } from './monitor-probe-signal.entity';
import { MonitorProbeState } from './monitor-probe-state.entity';
import { MonitorServer } from './monitor-server.entity';
import { MonitorService } from './monitor-service.entity';

// eslint-disable-next-line @typescript-eslint/ban-types
const NUEVAS: [Function, string][] = [
  [MonitorMaintenance, 'monitor_maintenance'],
  [MonitorEvidence, 'monitor_evidence'],
  [MonitorDailyRollup, 'monitor_daily_rollups'],
  [MonitorRollupDay, 'monitor_rollup_days'],
  [MonitorProbeGap, 'monitor_probe_gaps'],
  [MonitorAgentSample, 'monitor_agent_samples'],
  [MonitorAgentDailyRollup, 'monitor_agent_daily_rollups'],
  [MonitorMonthlyReport, 'monitor_monthly_reports'],
];

/**
 * Construye los metadatos sin conectar: `buildMetadatas` es protegido en
 * TypeORM 0.3, pero es la vía pública de facto que usa `initialize()` antes de
 * abrir la conexión; aquí se invoca solo para validar el mapeo.
 */
function buildMetadata() {
  const ds = new DataSource({
    type: 'mysql',
    database: 'kubo_devdocs',
    entities: [
      MonitorServer,
      MonitorService,
      MonitorProbe,
      MonitorCheck,
      MonitorProbeSignal,
      MonitorProbeOrder,
      MonitorProbeState,
      MonitorIncident,
      MonitorIncidentEvent,
      MonitorOfficeOutage,
      ...NUEVAS.map(([e]) => e),
    ],
  });
  (ds as unknown as { buildMetadatas(): void }).buildMetadatas();
  return ds;
}

describe('entidades de disponibilidad', () => {
  const ds = buildMetadata();

  it('MonitorCheck tiene clave primaria compuesta (probeId, id)', () => {
    const meta = ds.getMetadata(MonitorCheck);
    expect(meta.primaryColumns.map((c) => c.propertyName)).toEqual(['probeId', 'id']);
  });

  it('MonitorProbeSignal tiene índice único (probeId, uuid)', () => {
    const meta = ds.getMetadata(MonitorProbeSignal);
    const unique = meta.indices.filter((i) => i.isUnique);
    expect(unique.map((i) => i.columns.map((c) => c.propertyName))).toContainEqual([
      'probeId',
      'uuid',
    ]);
  });

  it('MonitorProbeState tiene clave primaria (serviceId, probeId)', () => {
    const meta = ds.getMetadata(MonitorProbeState);
    expect(meta.primaryColumns.map((c) => c.propertyName)).toEqual(['serviceId', 'probeId']);
  });
});

describe('columnas booleanas', () => {
  const ds = buildMetadata();

  it.each([
    [MonitorCheck, 'ok'],
    [MonitorProbeState, 'lastOk'],
  ])('%p.%s se mapea como boolean (TypeORM convierte 0/1)', (entity, prop) => {
    const col = ds.getMetadata(entity).findColumnWithPropertyName(prop as string);
    expect(col?.type).toBe('boolean');
  });
});

describe('entidades del informe y el agente (migración 034)', () => {
  const ds = buildMetadata();
  const modulo = readFileSync(join(__dirname, '..', 'availability.module.ts'), 'utf8');

  it.each(NUEVAS)('%p mapea su tabla %s y se registra en AvailabilityModule', (entidad, tabla) => {
    expect(ds.getMetadata(entidad).tableName).toBe(tabla);
    expect(modulo).toMatch(new RegExp(`^ +${entidad.name},`, 'm'));
  });

  it('MonitorServer suma las columnas del agente', () => {
    const meta = ds.getMetadata(MonitorServer);
    for (const p of ['agentWatchServices', 'agentTokenCreatedAt', 'agentSilenceAlertedAt', 'agentVersion']) {
      expect(meta.findColumnWithPropertyName(p)).toBeDefined();
    }
  });

  it('MonitorMonthlyReport es único por (clientId, month)', () => {
    const u = ds.getMetadata(MonitorMonthlyReport).indices.filter((i) => i.isUnique);
    expect(u.map((i) => i.columns.map((c) => c.propertyName))).toContainEqual(['clientId', 'month']);
  });

  it('MonitorRollupDay tiene clave primaria date', () => {
    expect(ds.getMetadata(MonitorRollupDay).primaryColumns.map((c) => c.propertyName)).toEqual(['date']);
  });
});
