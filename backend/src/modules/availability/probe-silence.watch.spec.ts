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
  // Pasado el periodo de gracia de arranque, salvo que la prueba diga otra cosa.
  watch.startedAt = new Date(NOW.getTime() - 10 * 60_000);
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

  it('escapa el código de la sonda en el cuerpo HTML', async () => {
    const p = { ...silent(), code: '<b>x</b>' };
    const { watch, email } = make({ probes: [p] });
    await watch.check(NOW);
    const arg = email.send.mock.calls[0][0];
    expect(arg.html).not.toContain('<b>x</b>');
    expect(arg.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('no alerta durante los 2 primeros minutos tras arrancar', async () => {
    const { watch, email } = make();
    watch.startedAt = new Date(NOW.getTime() - 60_000);
    await watch.check(NOW);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('en el periodo de gracia la recuperación sí se procesa', async () => {
    const p = { ...silent(), lastSeenAt: new Date(NOW.getTime() - 5000), silenceAlertedAt: new Date(NOW.getTime() - 20 * 60_000) };
    const { watch, email } = make({ probes: [p] });
    watch.startedAt = new Date(NOW.getTime() - 60_000);
    await watch.check(NOW);
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('si la marca no se escribe (affected 0) tras avisar, lo registra y no reenvía el minuto siguiente', async () => {
    const { watch, repo, email } = make({ affected: 0 });
    const warn = jest.spyOn((watch as any).logger, 'warn').mockImplementation(() => undefined);
    await watch.check(NOW);
    await watch.check(new Date(NOW.getTime() + 60_000));
    await watch.check(new Date(NOW.getTime() + 120_000));
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('oficina-01');
  });

  it('recuperación sin escribir (affected 0): no reenvía; si vuelve a callar, avisa una vez', async () => {
    const alertedAt = new Date(NOW.getTime() - 20 * 60_000);
    const p = { ...silent(), lastSeenAt: new Date(NOW.getTime() - 5000), silenceAlertedAt: alertedAt };
    const { watch, email } = make({ probes: [p], affected: 0 });
    jest.spyOn((watch as any).logger, 'warn').mockImplementation(() => undefined);
    await watch.check(NOW);
    await watch.check(new Date(NOW.getTime() + 60_000));
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send.mock.calls[0][0].subject).toContain('volvió a reportar');
    // Vuelve a callar (la base sigue con la marca vieja): se avisa del nuevo silencio una sola vez.
    const later = new Date(NOW.getTime() + 15 * 60_000);
    await watch.check(later);
    await watch.check(new Date(later.getTime() + 60_000));
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(email.send.mock.calls[1][0].subject).toContain('dejó de reportar');
  });

  it('una escritura de otro proceso descarta lo de memoria: vuelve a mandar la base', async () => {
    const probe = silent();
    const { watch, repo, email } = make({ probes: [probe], affected: 0 });
    jest.spyOn((watch as any).logger, 'warn').mockImplementation(() => undefined);
    await watch.check(NOW);
    expect(email.send).toHaveBeenCalledTimes(1);
    probe.silenceAlertedAt = new Date(NOW.getTime() + 30_000);
    probe.lastSeenAt = new Date(NOW.getTime() + 90_000);
    repo.update.mockResolvedValue({ affected: 1 });
    await watch.check(new Date(NOW.getTime() + 120_000));
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(email.send.mock.calls[1][0].subject).toContain('volvió a reportar');
  });

  it('sin administradores, la recuperación tampoco repite la advertencia cada minuto', async () => {
    const p = { ...silent(), lastSeenAt: new Date(NOW.getTime() - 5000), silenceAlertedAt: new Date(NOW.getTime() - 20 * 60_000) };
    const { watch } = make({ probes: [p], admins: [] });
    const warn = jest.spyOn((watch as any).logger, 'warn').mockImplementation(() => undefined);
    await watch.check(NOW);
    await watch.check(new Date(NOW.getTime() + 60_000));
    await watch.check(new Date(NOW.getTime() + 120_000));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('sin administradores advierte una sola vez por sonda y silencio', async () => {
    const { watch } = make({ admins: [] });
    const warn = jest.spyOn((watch as any).logger, 'warn').mockImplementation(() => undefined);
    await watch.check(NOW);
    await watch.check(new Date(NOW.getTime() + 60_000));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
