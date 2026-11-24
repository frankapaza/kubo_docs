import { DataSource } from 'typeorm';
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
