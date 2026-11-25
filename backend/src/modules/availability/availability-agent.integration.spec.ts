import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { AgentRateLimiter } from './agent-rate-limiter';
import { AgentTokenGuard } from './agent-token.guard';
import { AvailabilityAgentController } from './availability-agent.controller';
import { AvailabilityAgentService } from './availability-agent.service';
import { MonitorAgentSample } from './entities/monitor-agent-sample.entity';
import { MonitorServer } from './entities/monitor-server.entity';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const TOKEN_A = 'kma_' + 'a'.repeat(43);
const TOKEN_B = 'kma_' + 'b'.repeat(43);
const REVOKED = 'kma_' + 'r'.repeat(43);
const PATH = '/ingest/probe/agent/samples';

const sample = (over: Record<string, unknown> = {}) => ({
  agentVersion: '1.0.0',
  cpuPct: 12.5,
  ramPct: 61.2,
  disks: [{ name: 'C:', totalBytes: 107374182400, freeBytes: 9663676416 }],
  iisPools: [{ name: 'DefaultAppPool', state: 'Started' }],
  services: [{ name: 'W3SVC', status: 'Running' }],
  eventErrors: { system: 0, application: 3 },
  ...over,
});

describe('/ingest/probe/agent/samples (integración HTTP)', () => {
  let app: TestHttpApp;
  let servers: any[];
  const inserted: any[] = [];
  const updates: Array<[any, any]> = [];

  beforeAll(async () => {
    servers = [
      { id: 10, name: 'srv-a', status: 'ACTIVE', agentTokenHash: hash(TOKEN_A), agentWatchServices: ['W3SVC'] },
      { id: 11, name: 'srv-b', status: 'ACTIVE', agentTokenHash: hash(TOKEN_B), agentWatchServices: null },
      { id: 12, name: 'srv-r', status: 'ACTIVE', agentTokenHash: null, agentWatchServices: null },
    ];
    const serverRepo = {
      findOne: async ({ where }: any) =>
        servers.find((s) => Object.entries(where).every(([k, v]) => s[k] === v)) ?? null,
      update: jest.fn(async (id: number, patch: any) => {
        updates.push([id, patch]);
        Object.assign(servers.find((s) => s.id === id), patch);
        return { affected: 1 };
      }),
    };
    const sampleRepo = { insert: jest.fn(async (row: any) => inserted.push(row)) };
    const moduleRef = await Test.createTestingModule({
      controllers: [AvailabilityAgentController],
      providers: [
        AgentTokenGuard,
        AgentRateLimiter,
        AvailabilityAgentService,
        { provide: getRepositoryToken(MonitorServer), useValue: serverRepo },
        { provide: getRepositoryToken(MonitorAgentSample), useValue: sampleRepo },
      ],
    }).compile();
    app = await startTestHttpApp(moduleRef);
  });
  afterAll(async () => app?.close());

  it('un token de sonda (kmp_) -> 401 con el cuerpo de agente', async () => {
    const res = await app.post(PATH, { token: 'kmp_' + 'a'.repeat(43), body: sample() });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED', message: 'Token de agente inválido o revocado.' });
  });

  it('un kma_ revocado -> 401', async () => {
    const res = await app.post(PATH, { token: REVOKED, body: sample() });
    expect(res.status).toBe(401);
  });

  it('cpuPct 101 -> 400 y no guarda', async () => {
    const before = inserted.length;
    const res = await app.post(PATH, { token: TOKEN_B, body: sample({ cpuPct: 101 }) });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ statusCode: 400, code: 'BAD_INPUT' });
    expect(typeof res.body.message).toBe('string');
    expect(inserted.length).toBe(before);
  });

  it('más de 26 discos o eventErrors negativo -> 400', async () => {
    const disks = Array.from({ length: 27 }, (_, i) => ({ name: `D${i}:`, totalBytes: 1, freeBytes: 1 }));
    expect((await app.post(PATH, { token: TOKEN_B, body: sample({ disks }) })).status).toBe(400);
    expect((await app.post(PATH, { token: TOKEN_B, body: sample({ eventErrors: { system: -1, application: 0 } }) })).status).toBe(400);
  });

  it('cuerpo de más de 64 KB -> 413', async () => {
    const res = await app.post(PATH, { token: TOKEN_B, body: sample({ agentVersion: 'x'.repeat(70_000) }) });
    expect(res.status).toBe(413);
  });

  it('muestra válida -> 200 con watchServices, guarda la fila y marca el servidor; otra antes de 20 s -> 429', async () => {
    const res = await app.post(PATH, { token: TOKEN_A, body: sample() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ watchServices: ['W3SVC'], intervalSeconds: 60 });

    const row = inserted[inserted.length - 1];
    expect(row).toMatchObject({
      serverId: 10,
      cpuPct: 12.5,
      ramPct: 61.2,
      eventErrors: 3,
      agentVersion: '1.0.0',
      disks: [{ name: 'C:', totalBytes: 107374182400, freeBytes: 9663676416 }],
      iis: { pools: [{ name: 'DefaultAppPool', state: 'Started' }] },
      services: [{ name: 'W3SVC', status: 'Running' }],
    });
    expect(row.at).toBeInstanceOf(Date);
    expect(servers[0].agentLastSeenAt).toEqual(row.at);
    expect(servers[0].agentVersion).toBe('1.0.0');

    const again = await app.post(PATH, { token: TOKEN_A, body: sample() });
    expect(again.status).toBe(429);
    expect(Number(again.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });

  it('iisPools null y watch services null -> se guarda pools null y responde lista vacía', async () => {
    const res = await app.post(PATH, { token: TOKEN_B, body: sample({ iisPools: null }) });
    expect(res.status).toBe(200);
    expect(res.body.watchServices).toEqual([]);
    expect(inserted[inserted.length - 1].iis).toEqual({ pools: null });
  });
});
