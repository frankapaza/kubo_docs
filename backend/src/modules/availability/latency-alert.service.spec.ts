import { Logger } from '@nestjs/common';

import { LatencyAlertService, previousHourStart } from './latency-alert.service';

const H = new Date('2026-11-28T19:00:00.000Z'); // 14:00 de Lima
const PREV = new Date('2026-11-28T18:00:00.000Z');

function pingsFor(serviceId: number, slowCount: number, total = 60) {
  return Array.from({ length: total }, (_, i) => ({
    probeId: 1,
    serviceId,
    kind: 'REGULAR',
    startedAt: new Date(H.getTime() + i * 60_000),
    durationMs: i < slowCount ? 400 : 120,
    ok: true,
  }));
}

function make(o: { checks?: any[]; emails?: string[]; services?: any[]; episodes?: any[]; hours?: any[] } = {}) {
  const services = o.services ?? [
    { id: 3, serverId: 2, name: 'Ping (red)', protocol: 'ICMP', target: '147.93.146.92', latencyThresholdMs: 250, status: 'ACTIVE' },
    { id: 5, serverId: 3, name: 'Ping (red)', protocol: 'ICMP', target: '147.93.146.129', latencyThresholdMs: 250, status: 'ACTIVE' },
  ];
  const servers = [
    { id: 2, name: 'PROSOL Web', host: '147.93.146.92' },
    { id: 3, name: 'PROSOL Database', host: '147.93.146.129' },
  ];
  const checks = o.checks ?? [];
  const hours: any[] = o.hours ?? [];
  const episodes: any[] = o.episodes ?? [];
  const sent: any[] = [];
  const svc = new LatencyAlertService(
    { find: jest.fn(async () => services) } as any,
    { find: jest.fn(async () => servers) } as any,
    { find: jest.fn(async () => [{ id: 1, code: 'oficina-01', kind: 'OFFICE' }]) } as any,
    { find: jest.fn(async ({ where }: any) => checks.filter((c) => c.serviceId === where.serviceId)) } as any,
    {
      findOne: jest.fn(async ({ where }: any) => hours.find((h) => h.serviceId === where.serviceId && h.hourStart.getTime() === where.hourStart.getTime()) ?? null),
      find: jest.fn(async ({ where }: any) => hours.filter((h) => h.serviceId === where.serviceId)),
      save: jest.fn(async (r: any) => { hours.push(r); return r; }),
      create: jest.fn((r: any) => r),
    } as any,
    {
      find: jest.fn(async () => episodes.filter((e) => e.endedHour === null)),
      findOne: jest.fn(async ({ where }: any) => episodes.find((e) => e.serviceId === where.serviceId && e.endedHour === null) ?? null),
      save: jest.fn(async (e: any) => { if (!episodes.includes(e)) { e.id = episodes.length + 1; episodes.push(e); } return e; }),
      create: jest.fn((e: any) => ({ endedHour: null, closedReason: null, ...e })),
    } as any,
    { listActiveAdmins: jest.fn(async () => [{ email: 'admin@kubo.pe' }]) } as any,
    { send: jest.fn(async (m: any) => { sent.push(m); return { messageId: 'x', accepted: [], rejected: [] }; }) } as any,
    { getLatencyAlertEmails: jest.fn(async () => o.emails ?? ['frankapazac@kuboti.com']) } as any,
    { get: jest.fn(() => 'https://docs.kuboti.com') } as any,
  );
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return { svc, hours, episodes, sent };
}

afterEach(() => jest.restoreAllMocks());

describe('LatencyAlertService.evaluateHour', () => {
  it('una hora con 30 % de pings lentos abre episodio y avisa a los destinatarios configurados', async () => {
    const t = make({ checks: [...pingsFor(3, 18), ...pingsFor(5, 0)] });
    await t.svc.evaluateHour(H);
    expect(t.hours.find((h) => h.serviceId === 3)).toMatchObject({ total: 60, slow: 18, isSlow: true, thresholdMs: 250 });
    expect(t.hours.find((h) => h.serviceId === 5)).toMatchObject({ slow: 0, isSlow: false });
    expect(t.episodes).toEqual([expect.objectContaining({ serviceId: 3, startedHour: H, endedHour: null, officeWide: false })]);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].to).toEqual(['frankapazac@kuboti.com']);
    expect(t.sent[0].subject).toContain('PROSOL Web');
    expect(t.sent[0].html).toContain('30 %');
    expect(t.sent[0].html).toContain('14:00');
    expect(t.sent[0].text).toContain('147.93.146.92');
  });

  it('volver a evaluar la misma hora no duplica filas ni correos', async () => {
    const t = make({ checks: [...pingsFor(3, 18), ...pingsFor(5, 0)] });
    await t.svc.evaluateHour(H);
    await t.svc.evaluateHour(H);
    expect(t.hours).toHaveLength(2);
    expect(t.episodes).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
  });

  it('una hora normal cierra el episodio y envía el resumen hora por hora', async () => {
    const episodes = [{ id: 1, serviceId: 3, startedHour: PREV, endedHour: null, officeWide: false, closedReason: null }];
    const hours = [{ serviceId: 3, hourStart: PREV, total: 60, slow: 30, avgMs: 300, p95Ms: 450, maxMs: 612, thresholdMs: 250, isSlow: true }];
    const t = make({ checks: [...pingsFor(3, 1), ...pingsFor(5, 0)], episodes, hours });
    await t.svc.evaluateHour(H);
    expect(episodes[0]).toMatchObject({ endedHour: H, closedReason: 'NORMAL' });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].subject).toMatch(/normaliz/i);
    expect(t.sent[0].html).toContain('612');
    expect(t.sent[0].html).toContain('13:00'); // hora lenta de Lima en la tabla
  });

  it('una hora sin datos suficientes (motor apagado) no abre ni cierra', async () => {
    const episodes = [{ id: 1, serviceId: 3, startedHour: PREV, endedHour: null, officeWide: false, closedReason: null }];
    const t = make({ checks: pingsFor(3, 0, 4), episodes });
    await t.svc.evaluateHour(H);
    expect(episodes[0].endedHour).toBeNull();
    expect(t.sent).toEqual([]);
  });

  it('todos los pings lentos a la vez: el correo apunta al internet de la oficina', async () => {
    const t = make({ checks: [...pingsFor(3, 40), ...pingsFor(5, 40)] });
    await t.svc.evaluateHour(H);
    expect(t.episodes.every((e) => e.officeWide)).toBe(true);
    expect(t.sent).toHaveLength(2);
    for (const m of t.sent) expect(m.html).toContain('internet de la oficina');
  });

  it('un ping que deja de estar activo cierra su episodio sin correo', async () => {
    const episodes = [{ id: 1, serviceId: 9, startedHour: PREV, endedHour: null, officeWide: false, closedReason: null }];
    const t = make({ checks: [...pingsFor(3, 0), ...pingsFor(5, 0)], episodes });
    await t.svc.evaluateHour(H);
    expect(episodes[0]).toMatchObject({ endedHour: H, closedReason: 'SERVICE_INACTIVE' });
    expect(t.sent).toEqual([]);
  });

  it('sin destinatarios configurados avisa a los administradores activos', async () => {
    const t = make({ checks: [...pingsFor(3, 18), ...pingsFor(5, 0)], emails: [] });
    await t.svc.evaluateHour(H);
    expect(t.sent[0].to).toEqual(['admin@kubo.pe']);
  });
});

describe('previousHourStart', () => {
  it('a las 14:05 evalúa la hora de las 13:00', () => {
    expect(previousHourStart(new Date('2026-11-28T19:05:12Z')).toISOString()).toBe('2026-11-28T18:00:00.000Z');
  });
});
