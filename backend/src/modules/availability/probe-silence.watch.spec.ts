import { ProbeSilenceWatch } from './probe-silence.watch';

const NOW = new Date('2026-11-24T15:00:00.000Z');
const silent = () => ({
  id: 7,
  code: 'oficina-01',
  kind: 'OFFICE' as const,
  tokenHash: 'x'.repeat(64),
  lastSeenAt: new Date(NOW.getTime() - 11 * 60_000),
  silenceAlertedAt: null as Date | null,
});

const make = (opts: { probes?: any[]; admins?: any[]; sendFails?: boolean; affected?: number } = {}) => {
  const probes = opts.probes ?? [silent()];
  const repo = {
    find: jest.fn().mockResolvedValue(probes),
    update: jest.fn().mockResolvedValue({ affected: opts.affected ?? 1 }),
  };
  const users = {
    listActiveAdmins: jest.fn().mockResolvedValue(opts.admins ?? [{ email: 'a@k.com' }, { email: 'b@k.com' }]),
  };
  const email = {
    send: opts.sendFails ? jest.fn().mockRejectedValue(new Error('smtp')) : jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn().mockReturnValue('https://app.kubo.test') };
  const watch = new ProbeSilenceWatch(repo as any, users as any, email as any, config as any);
  return { watch, repo, users, email };
};

describe('ProbeSilenceWatch', () => {
  it('envía el aviso a los administradores activos y marca la columna', async () => {
    const { watch, repo, email } = make();
    await watch.check(NOW);
    expect(email.send).toHaveBeenCalledTimes(1);
    const arg = email.send.mock.calls[0][0];
    expect(arg.to).toEqual(['a@k.com', 'b@k.com']);
    expect(arg.subject).toBe('Monitoreo: la sonda oficina-01 dejó de reportar');
    expect(arg.html).toContain('https://app.kubo.test/monitoreo/sondas');
    expect(arg.text).toContain('oficina-01');
    expect(repo.update).toHaveBeenCalledWith({ id: 7, silenceAlertedAt: expect.anything() }, { silenceAlertedAt: NOW });
  });

  it('un solo correo aunque corra dos veces seguidas', async () => {
    const probe = silent();
    const { watch, repo, email } = make({ probes: [probe] });
    repo.update.mockImplementation(async (_w: any, set: any) => {
      probe.silenceAlertedAt = set.silenceAlertedAt;
      return { affected: 1 };
    });
    await watch.check(NOW);
    await watch.check(NOW);
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('si la sonda ya figura avisada en la lectura, no reenvía', async () => {
    const p = { ...silent(), silenceAlertedAt: new Date(NOW.getTime() - 60_000) };
    const { watch, email } = make({ probes: [p] });
    await watch.check(NOW);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('sin administradores activos no falla, no envía y no marca', async () => {
    const { watch, repo, email } = make({ admins: [] });
    await expect(watch.check(NOW)).resolves.toBeUndefined();
    expect(email.send).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('si el correo falla no fija la columna y no propaga', async () => {
    const { watch, repo } = make({ sendFails: true });
    await expect(watch.check(NOW)).resolves.toBeUndefined();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('al volver envía el aviso de recuperación y limpia la columna', async () => {
    const p = {
      ...silent(),
      lastSeenAt: new Date(NOW.getTime() - 5000),
      silenceAlertedAt: new Date(NOW.getTime() - 20 * 60_000),
    };
    const { watch, repo, email } = make({ probes: [p] });
    await watch.check(NOW);
    expect(email.send.mock.calls[0][0].subject).toBe('Monitoreo: la sonda oficina-01 volvió a reportar');
    expect(repo.update).toHaveBeenCalledWith({ id: 7, silenceAlertedAt: p.silenceAlertedAt }, { silenceAlertedAt: null });
  });
});
