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

const make = (opts: { servers?: any[]; admins?: any[]; sendFails?: boolean; affected?: number; maintenance?: any[] } = {}) => {
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
  const maintenance = { find: jest.fn(async () => opts.maintenance ?? []) };
  const watch = new AgentSilenceWatch(repo as any, users as any, email as any, config as any, maintenance as any);
  watch.startedAt = new Date(NOW.getTime() - 10 * 60_000);
  return { watch, repo, users, email, maintenance };
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

  describe('mantenimiento del servidor', () => {
    const win = (over: any = {}) => ({
      id: 1, serverId: 10, serviceId: null, reason: 'parche',
      startsAt: new Date(NOW.getTime() - 30 * 60_000), endsAt: new Date(NOW.getTime() + 30 * 60_000), ...over,
    });

    it('con una ventana del servidor activa no envía el aviso ni marca; al terminar la ventana sí avisa', async () => {
      const { watch, repo, email, maintenance } = make({ maintenance: [win()] });
      await watch.check(NOW);
      expect(maintenance.find).toHaveBeenCalledTimes(1);
      expect(email.send).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      maintenance.find.mockResolvedValue([]);
      await watch.check(new Date(NOW.getTime() + 31 * 60_000));
      expect(email.send.mock.calls[0][0].subject).toBe('[KUBO Monitoreo] El agente de srv-app no reporta');
    });

    it('una ventana de un servicio o de otro servidor no silencia el aviso', async () => {
      const { watch, email } = make({ maintenance: [win({ serverId: null, serviceId: 100 }), win({ serverId: 11 })] });
      await watch.check(NOW);
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('si vuelve durante la ventana avisa la vuelta solo si el aviso se había enviado', async () => {
      const back = { agentLastSeenAt: new Date(NOW.getTime() - 5000) };
      const sent = make({ servers: [silent({ ...back, agentSilenceAlertedAt: new Date(NOW.getTime() - 40 * 60_000) })], maintenance: [win()] });
      await sent.watch.check(NOW);
      expect(sent.email.send.mock.calls[0][0].subject).toBe('[KUBO Monitoreo] El agente de srv-app volvió a reportar');
      const muted = make({ servers: [silent()], maintenance: [win()] });
      await muted.watch.check(NOW);
      const server = silent(back);
      const later = make({ servers: [server], maintenance: [win()] });
      await later.watch.check(NOW);
      expect(muted.email.send).not.toHaveBeenCalled();
      expect(later.email.send).not.toHaveBeenCalled();
    });

    it('lee las ventanas una sola vez por pasada', async () => {
      const { watch, maintenance } = make({ servers: [silent({ id: 1 }), silent({ id: 2 }), silent({ id: 3 })] });
      await watch.check(NOW);
      expect(maintenance.find).toHaveBeenCalledTimes(1);
    });
  });
});
