import type { CombinedStateRow, ServerAlert } from '../src/central-client';
import { diffServerAlerts, diffStates, maskMaintenance } from '../src/events/diff-states';

const row = (serviceId: number, over: Partial<CombinedStateRow> = {}): CombinedStateRow => ({
  serviceId,
  serverId: 10,
  clientId: 100,
  serviceName: `svc-${serviceId}`,
  serverName: 'srv-a',
  criticality: 'HIGH',
  office: null,
  datacenter: null,
  status: 'OK',
  incidentId: null,
  parentIncidentId: null,
  ticketCode: null,
  ...over,
});

describe('diffStates', () => {
  it('prev null (primer estado tras arrancar) → ningún evento', () => {
    expect(diffStates(null, [row(1, { status: 'DOWN', incidentId: 5 })])).toEqual([]);
  });

  it('abrir DOWN HIGH → un INCIDENT_OPENED con notify true', () => {
    const ev = diffStates([row(1)], [row(1, { status: 'DOWN', incidentId: 5, ticketCode: 'KT-1' })]);
    expect(ev).toEqual([
      {
        kind: 'INCIDENT_OPENED',
        incidentKey: 5,
        incidentKind: 'DOWN',
        serverName: 'srv-a',
        serviceNames: ['svc-1'],
        criticality: 'HIGH',
        ticketCode: 'KT-1',
        serverId: null,
        alertKind: null,
        detail: null,
        notify: true,
      },
    ]);
  });

  it('abrir ROUTE MEDIUM → OPENED con notify false', () => {
    const ev = diffStates([row(1)], [row(1, { status: 'ROUTE', incidentId: 5, criticality: 'MEDIUM' })]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'INCIDENT_OPENED', incidentKind: 'ROUTE', criticality: 'MEDIUM', notify: false });
  });

  it('dos servicios del mismo servidor con el mismo parentIncidentId → un solo OPENED con los dos nombres y la criticidad más alta', () => {
    const prev = [row(2, { criticality: 'LOW' }), row(1, { criticality: 'MEDIUM' })];
    const next = [
      row(2, { status: 'DOWN', incidentId: 7, parentIncidentId: 9, criticality: 'LOW' }),
      row(1, { status: 'DOWN', incidentId: 8, parentIncidentId: 9, criticality: 'MEDIUM' }),
    ];
    const ev = diffStates(prev, next);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      kind: 'INCIDENT_OPENED',
      incidentKey: 9,
      serviceNames: ['svc-1', 'svc-2'],
      criticality: 'MEDIUM',
      notify: false,
    });
  });

  it('recuperar → un INCIDENT_RECOVERED con los datos del incidente', () => {
    const prev = [row(1, { status: 'DOWN', incidentId: 5, ticketCode: 'KT-1' }), row(2, { status: 'DOWN', incidentId: 6, parentIncidentId: 5 })];
    const ev = diffStates(prev, [row(1), row(2)]);
    expect(ev).toEqual([
      {
        kind: 'INCIDENT_RECOVERED',
        incidentKey: 5,
        incidentKind: 'DOWN',
        serverName: 'srv-a',
        serviceNames: ['svc-1', 'svc-2'],
        criticality: 'HIGH',
        ticketCode: 'KT-1',
        serverId: null,
        alertKind: null,
        detail: null,
        notify: true,
      },
    ]);
  });

  it('una clave que desaparece del estado → RECOVERED', () => {
    const ev = diffStates([row(1, { status: 'ROUTE', incidentId: 5 })], []);
    expect(ev.map((e) => e.kind)).toEqual(['INCIDENT_RECOVERED']);
  });

  it('ROUTE → DOWN de la misma clave → INCIDENT_UPGRADED', () => {
    const ev = diffStates([row(1, { status: 'ROUTE', incidentId: 5 })], [row(1, { status: 'DOWN', incidentId: 5 })]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'INCIDENT_UPGRADED', incidentKey: 5, incidentKind: 'DOWN', notify: true });
  });

  it('sin cambios → ningún evento', () => {
    const s = [row(1, { status: 'DOWN', incidentId: 5 }), row(2, { status: 'DEGRADED' })];
    expect(diffStates(s, s.map((r) => ({ ...r })))).toEqual([]);
  });

  it('DEGRADED → DEGRADED_STARTED con notify false; y al volver a OK, DEGRADED_CLEARED', () => {
    const started = diffStates([row(1)], [row(1, { status: 'DEGRADED' })]);
    expect(started).toEqual([
      {
        kind: 'DEGRADED_STARTED',
        incidentKey: null,
        incidentKind: 'DEGRADED',
        serverName: 'srv-a',
        serviceNames: ['svc-1'],
        criticality: 'HIGH',
        ticketCode: null,
        serverId: null,
        alertKind: null,
        detail: null,
        notify: false,
      },
    ]);
    const cleared = diffStates([row(1, { status: 'DEGRADED' })], [row(1)]);
    expect(cleared.map((e) => [e.kind, e.notify])).toEqual([['DEGRADED_CLEARED', false]]);
  });

  describe('absorción en un incidente de servidor (decisión 19)', () => {
    it('svc1 DOWN HIGH (clave 7) → svc1+svc2 bajo el padre 9: un solo OPENED(9) sin aviso y ningún RECOVERED', () => {
      const prev = [row(1, { status: 'DOWN', incidentId: 7 }), row(2)];
      const next = [
        row(1, { status: 'DOWN', incidentId: 7, parentIncidentId: 9 }),
        row(2, { status: 'DOWN', incidentId: 8, parentIncidentId: 9 }),
      ];
      const ev = diffStates(prev, next);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ kind: 'INCIDENT_OPENED', incidentKey: 9, serviceNames: ['svc-1', 'svc-2'], criticality: 'HIGH', notify: false });
    });

    it('svc1 MEDIUM heredado + svc2 HIGH nuevo → OPENED(9) con aviso', () => {
      const prev = [row(1, { status: 'DOWN', incidentId: 7, criticality: 'MEDIUM' }), row(2)];
      const next = [
        row(1, { status: 'DOWN', incidentId: 7, parentIncidentId: 9, criticality: 'MEDIUM' }),
        row(2, { status: 'DOWN', incidentId: 8, parentIncidentId: 9 }),
      ];
      expect(diffStates(prev, next).map((e) => [e.kind, e.incidentKey, e.notify])).toEqual([['INCIDENT_OPENED', 9, true]]);
    });

    it('el padre se cierra → un RECOVERED(9) con aviso', () => {
      const prev = [
        row(1, { status: 'DOWN', incidentId: 7, parentIncidentId: 9 }),
        row(2, { status: 'DOWN', incidentId: 8, parentIncidentId: 9 }),
      ];
      expect(diffStates(prev, [row(1), row(2)]).map((e) => [e.kind, e.incidentKey, e.notify])).toEqual([['INCIDENT_RECOVERED', 9, true]]);
    });

    it('solo ROUTE heredado → padre DOWN: INCIDENT_UPGRADED y ningún RECOVERED', () => {
      const prev = [row(1, { status: 'ROUTE', incidentId: 7, criticality: 'MEDIUM' }), row(2)];
      const next = [
        row(1, { status: 'DOWN', incidentId: 7, parentIncidentId: 9, criticality: 'MEDIUM' }),
        row(2, { status: 'DOWN', incidentId: 8, parentIncidentId: 9 }),
      ];
      expect(diffStates(prev, next).map((e) => [e.kind, e.incidentKey, e.notify])).toEqual([['INCIDENT_UPGRADED', 9, true]]);
    });

    it('ROUTE HIGH heredado → padre DOWN: UPGRADED con aviso (igual que ROUTE→DOWN de la misma clave)', () => {
      const prev = [row(1, { status: 'ROUTE', incidentId: 7 }), row(2, { criticality: 'LOW' })];
      const next = [
        row(1, { status: 'DOWN', incidentId: 7, parentIncidentId: 9 }),
        row(2, { status: 'DOWN', incidentId: 8, parentIncidentId: 9, criticality: 'LOW' }),
      ];
      expect(diffStates(prev, next).map((e) => [e.kind, e.incidentKey, e.notify])).toEqual([['INCIDENT_UPGRADED', 9, true]]);
    });

    it('si solo parte de los servicios sigue caída bajo otra clave, la vieja se recupera solo con lo recuperado y la nueva no repite el aviso', () => {
      const prev = [row(1, { status: 'DOWN', incidentId: 7, parentIncidentId: 5 }), row(2, { status: 'DOWN', incidentId: 8, parentIncidentId: 5 })];
      const next = [row(1, { status: 'DOWN', incidentId: 9 }), row(2)];
      const ev = diffStates(prev, next);
      expect(ev.map((e) => [e.kind, e.incidentKey, e.serviceNames, e.notify])).toEqual([
        ['INCIDENT_RECOVERED', 5, ['svc-2'], true],
        ['INCIDENT_OPENED', 9, ['svc-1'], false],
      ]);
    });

    it('recuperación parcial: el padre 9 = {svc1 HIGH, svc2 MEDIUM}; svc1 sigue caído como clave 7 y svc2 se recupera → RECOVERED(9) solo con svc2, MEDIUM, sin aviso', () => {
      const prev = [
        row(1, { status: 'DOWN', incidentId: 7, parentIncidentId: 9 }),
        row(2, { status: 'DOWN', incidentId: 8, parentIncidentId: 9, criticality: 'MEDIUM' }),
      ];
      const next = [row(1, { status: 'DOWN', incidentId: 7 }), row(2, { criticality: 'MEDIUM' })];
      const ev = diffStates(prev, next);
      const rec = ev.filter((e) => e.kind === 'INCIDENT_RECOVERED');
      expect(rec).toHaveLength(1);
      expect(rec[0]).toMatchObject({ incidentKey: 9, serviceNames: ['svc-2'], criticality: 'MEDIUM', notify: false });
      // svc1 ya avisó su caída (HIGH) y el RECOVERED no lo nombra: la clave 7 se anota sin repetir el aviso.
      expect(ev.filter((e) => e.kind !== 'INCIDENT_RECOVERED').map((e) => [e.kind, e.incidentKey, e.notify])).toEqual([['INCIDENT_OPENED', 7, false]]);
    });

    it('el padre 9 = {A HIGH, B MEDIUM}; A se recupera y B pasa a la clave 7 con C HIGH que acaba de caer → OPENED(7) con aviso', () => {
      const prev = [
        row(1, { status: 'DOWN', incidentId: 4, parentIncidentId: 9 }),
        row(2, { status: 'DOWN', incidentId: 8, parentIncidentId: 9, criticality: 'MEDIUM' }),
        row(3),
      ];
      const next = [
        row(1),
        row(2, { status: 'DOWN', incidentId: 8, parentIncidentId: 7, criticality: 'MEDIUM' }),
        row(3, { status: 'DOWN', incidentId: 6, parentIncidentId: 7 }),
      ];
      expect(diffStates(prev, next).map((e) => [e.kind, e.incidentKey, e.serviceNames, e.notify])).toEqual([
        ['INCIDENT_RECOVERED', 9, ['svc-1'], true],
        ['INCIDENT_OPENED', 7, ['svc-2', 'svc-3'], true],
      ]);
    });

    it('A HIGH caído (clave 7) absorbido en el padre 9 con D MEDIUM nuevo → OPENED(9) sin aviso', () => {
      const prev = [row(1, { status: 'DOWN', incidentId: 7 }), row(4, { criticality: 'MEDIUM' })];
      const next = [
        row(1, { status: 'DOWN', incidentId: 7, parentIncidentId: 9 }),
        row(4, { status: 'DOWN', incidentId: 8, parentIncidentId: 9, criticality: 'MEDIUM' }),
      ];
      expect(diffStates(prev, next).map((e) => [e.kind, e.incidentKey, e.criticality, e.notify])).toEqual([['INCIDENT_OPENED', 9, 'HIGH', false]]);
    });

    it('A MEDIUM caído (clave 7) absorbido en el padre 9 con C HIGH nuevo → OPENED(9) con aviso', () => {
      const prev = [row(1, { status: 'DOWN', incidentId: 7, criticality: 'MEDIUM' }), row(3)];
      const next = [
        row(1, { status: 'DOWN', incidentId: 7, parentIncidentId: 9, criticality: 'MEDIUM' }),
        row(3, { status: 'DOWN', incidentId: 8, parentIncidentId: 9 }),
      ];
      expect(diffStates(prev, next).map((e) => [e.kind, e.incidentKey, e.criticality, e.notify])).toEqual([['INCIDENT_OPENED', 9, 'HIGH', true]]);
    });
  });
});

describe('maskMaintenance (decisión 5)', () => {
  it('una fila en mantenimiento se reemplaza por la fila previa del mismo servicio (conserva la marca)', () => {
    const prev = [row(1, { status: 'DOWN', incidentId: 5 })];
    const masked = maskMaintenance(prev, [row(1, { maintenance: true })]);
    expect(masked).toEqual([row(1, { status: 'DOWN', incidentId: 5, maintenance: true })]);
  });

  it('sin fila previa se usa la misma fila en OK, sin incidentes', () => {
    const masked = maskMaintenance(null, [row(1, { status: 'DOWN', incidentId: 5, parentIncidentId: 4, maintenance: true })]);
    expect(masked).toEqual([row(1, { status: 'OK', incidentId: null, parentIncidentId: null, maintenance: true })]);
  });

  it('las filas sin mantenimiento (o de una central vieja sin el campo) pasan tal cual', () => {
    const next = [row(1, { status: 'DOWN', incidentId: 5 }), row(2, { maintenance: false })];
    expect(maskMaintenance([row(1)], next)).toEqual(next);
  });

  it('un servicio caído que entra en mantenimiento no genera INCIDENT_RECOVERED', () => {
    const prev = [row(1, { status: 'DOWN', incidentId: 5 })];
    const next = maskMaintenance(prev, [row(1, { maintenance: true })]);
    expect(diffStates(prev, next)).toEqual([]);
  });

  it('un incidente abierto durante la ventana no avisa hasta que maintenance pasa a false, y ahí sí', () => {
    let prev: CombinedStateRow[] = [row(1)];
    const during = maskMaintenance(prev, [row(1, { status: 'DOWN', incidentId: 8, maintenance: true })]);
    expect(diffStates(prev, during)).toEqual([]);
    prev = during;
    const still = maskMaintenance(prev, [row(1, { status: 'DOWN', incidentId: 8, maintenance: true })]);
    expect(diffStates(prev, still)).toEqual([]);
    prev = still;
    const after = maskMaintenance(prev, [row(1, { status: 'DOWN', incidentId: 8, maintenance: false })]);
    expect(diffStates(prev, after).map((e) => [e.kind, e.incidentKey, e.notify])).toEqual([['INCIDENT_OPENED', 8, true]]);
  });
});

describe('diffServerAlerts (decisión 11)', () => {
  const disk = (detail = 'C: 9 % libre', serverId = 3): ServerAlert => ({ serverId, serverName: 'srv-b', kind: 'DISK_LOW', detail });
  const silent: ServerAlert = { serverId: 4, serverName: 'srv-c', kind: 'AGENT_SILENT', detail: 'sin datos desde 14:32' };

  it('prev null (primer arranque sin estado guardado) → ningún evento', () => {
    expect(diffServerAlerts(null, [disk(), silent])).toEqual([]);
  });

  it('aparece un DISK_LOW → SERVER_ALERT_STARTED con notify true', () => {
    expect(diffServerAlerts([], [disk()])).toEqual([
      {
        kind: 'SERVER_ALERT_STARTED',
        incidentKey: null,
        incidentKind: null,
        serverName: 'srv-b',
        serviceNames: [],
        criticality: null,
        ticketCode: null,
        serverId: 3,
        alertKind: 'DISK_LOW',
        detail: 'C: 9 % libre',
        notify: true,
      },
    ]);
  });

  it('aparece un AGENT_SILENT → STARTED con notify false', () => {
    const ev = diffServerAlerts([], [silent]);
    expect(ev.map((e) => [e.kind, e.serverId, e.alertKind, e.detail, e.notify])).toEqual([
      ['SERVER_ALERT_STARTED', 4, 'AGENT_SILENT', 'sin datos desde 14:32', false],
    ]);
  });

  it('desaparece → SERVER_ALERT_CLEARED con notify false y el detalle previo', () => {
    const ev = diffServerAlerts([disk(), silent], []);
    expect(ev.map((e) => [e.kind, e.serverId, e.alertKind, e.detail, e.notify])).toEqual([
      ['SERVER_ALERT_CLEARED', 3, 'DISK_LOW', 'C: 9 % libre', false],
      ['SERVER_ALERT_CLEARED', 4, 'AGENT_SILENT', 'sin datos desde 14:32', false],
    ]);
  });

  it('C: de 9 % a 8 % no emite; la hora de AGENT_SILENT tampoco cuenta', () => {
    expect(diffServerAlerts([disk('C: 9 % libre'), silent], [disk('C: 8 % libre'), { ...silent, detail: 'sin datos desde 22/11 14:32' }])).toEqual([]);
  });

  it('otra unidad u otro servidor sí es una alerta nueva', () => {
    const ev = diffServerAlerts([disk('C: 9 % libre')], [disk('C: 8 % libre'), disk('D: 5 % libre'), disk('C: 7 % libre', 5)]);
    expect(ev.map((e) => [e.kind, e.serverId, e.detail])).toEqual([
      ['SERVER_ALERT_STARTED', 3, 'D: 5 % libre'],
      ['SERVER_ALERT_STARTED', 5, 'C: 7 % libre'],
    ]);
  });
});
