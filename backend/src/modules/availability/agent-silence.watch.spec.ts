import { FindOperator } from 'typeorm';
import { AgentSilenceWatch } from './agent-silence.watch';

const NOW = new Date('2026-11-24T15:00:00.000Z');
const silent = (over: any = {}) => ({
  id: 10,
  name: 'srv-app',
  status: 'ACTIVE',
  agentTokenHash: 'x'.repeat(64),
  agentLastSeenAt: new Date(NOW.getTime() - 11 * 60_000) as Date | null,
  agentSilenceAlertedAt: null as Date | null,
  ...over,
});

const make = (opts: { servers?: any[]; admins?: any[]; sendFails?: boolean; affected?: number } = {}) => {
  const servers = opts.servers ?? [silent()];
  const repo = {
    find: jest.fn(async ({ where }: any) =>
      servers.filter((s) => s.status === where.status && (where.agentTokenHash instanceof FindOperator ? s.agentTokenHash !== null : true)),
    ),
    update: jest.fn().mockResolvedValue({ affected: opts.affected ?? 1 }),
  };
  const users = { listActiveAdmins: jest.fn().mockResolvedValue(opts.admins ?? [{ email: 'a@k.com' }]) };
  const email = { send: opts.sendFails ? jest.fn().mockRejectedValue(new Error('smtp')) : jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue('https://app.kubo.test/') };
  const watch = new AgentSilenceWatch(repo as any, users as any, email as any, config as any);
  watch.startedAt = new Date(NOW.getTime() - 10 * 60_000);
  return { watch, repo, users, email };
};

describe('AgentSilenceWatch', () => {
  it('envía el aviso con el asunto del agente y marca agent_silence_alerted_at', async () => {
    const { watch, repo, email } = make();
    await watch.check(NOW);
    expect(email.send).toHaveBeenCalledTimes(1);
    const arg = email.send.mock.calls[0][0];
    expect(arg.to).toEqual(['a@k.com']);
    expect(arg.subject).toBe('[KUBO Monitoreo] El agente de srv-app no reporta');
    expect(arg.html).toContain('https://app.kubo.test/monitoreo/servidores?serverId=10');
    expect(repo.update).toHaveBeenCalledWith({ id: 10, agentSilenceAlertedAt: expect.anything() }, { agentSilenceAlertedAt: NOW });
  });

  it('un solo correo por silencio aunque corra varias veces', async () => {
    const server = silent();
    const { watch, repo, email } = make({ servers: [server] });
    repo.update.mockImplementation(async (_w: any, set: any) => {
      server.agentSilenceAlertedAt = set.agentSilenceAlertedAt;
      return { affected: 1 };
    });
    await watch.check(NOW);
    await watch.check(new Date(NOW.getTime() + 60_000));
    await watch.check(new Date(NOW.getTime() + 120_000));
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('si la marca no se pudo escribir (affected 0) no reenvía', async () => {
    const { watch, email } = make({ affected: 0 });
    await watch.check(NOW);
    await watch.check(new Date(NOW.getTime() + 60_000));
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('al volver avisa «volvió a reportar» y limpia la columna', async () => {
    const s = silent({ agentLastSeenAt: new Date(NOW.getTime() - 5000), agentSilenceAlertedAt: new Date(NOW.getTime() - 60_000) });
    const { watch, repo, email } = make({ servers: [s] });
    await watch.check(NOW);
    expect(email.send.mock.calls[0][0].subject).toBe('[KUBO Monitoreo] El agente de srv-app volvió a reportar');
    expect(repo.update).toHaveBeenCalledWith(expect.anything(), { agentSilenceAlertedAt: null });
  });

  it('solo servidores ACTIVE con token; uno que nunca reportó no envía correo', async () => {
    const { watch, email, repo } = make({
      servers: [
        silent({ id: 1, status: 'PAUSED' }),
        silent({ id: 2, agentTokenHash: null }),
        silent({ id: 3, agentLastSeenAt: null }),
      ],
    });
    await watch.check(NOW);
    expect(repo.find).toHaveBeenCalledWith({ where: { status: 'ACTIVE', agentTokenHash: expect.any(FindOperator) } });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('no alerta durante la gracia de arranque', async () => {
    const { watch, email } = make();
    watch.startedAt = new Date(NOW.getTime() - 30_000);
    await watch.check(NOW);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('sin administradores o con el correo caído no marca ni propaga', async () => {
    for (const opts of [{ admins: [] }, { sendFails: true }]) {
      const { watch, repo } = make(opts);
      await expect(watch.check(NOW)).resolves.toBeUndefined();
      expect(repo.update).not.toHaveBeenCalled();
    }
  });
});
