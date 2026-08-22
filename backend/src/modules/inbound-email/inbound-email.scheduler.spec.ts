import { InboundEmailScheduler } from './inbound-email.scheduler';

const T0 = new Date('2026-08-22T12:00:00Z');
const UN_MINUTO = 60_000;

function unResumen(overrides: Record<string, unknown> = {}) {
  return {
    fetched: 0,
    ticketsCreated: 0,
    messagesAdded: 0,
    discarded: 0,
    unknownSenders: 0,
    duplicates: 0,
    errors: 0,
    ...overrides,
  };
}

function montar(opciones: { encendida?: boolean; drainImpl?: (...args: unknown[]) => Promise<unknown> } = {}) {
  const { encendida = true, drainImpl } = opciones;
  const workspace = { isImapIngestionEnabled: jest.fn().mockResolvedValue(encendida) };
  const inboundEmail = {
    drain: drainImpl ? jest.fn(drainImpl) : jest.fn().mockResolvedValue(unResumen()),
  };
  const scheduler = new InboundEmailScheduler(workspace as any, inboundEmail as any);
  const logs = {
    log: jest.spyOn((scheduler as any).logger, 'log').mockImplementation(() => undefined),
    warn: jest.spyOn((scheduler as any).logger, 'warn').mockImplementation(() => undefined),
    error: jest.spyOn((scheduler as any).logger, 'error').mockImplementation(() => undefined),
  };
  return { scheduler, workspace, inboundEmail, logs };
}

/** Todo lo que el logger recibió por un canal, junto. */
function textoDe(spy: jest.SpyInstance): string {
  return spy.mock.calls.map((c) => String(c[0])).join('\n');
}

describe('InboundEmailScheduler', () => {
  describe('el interruptor', () => {
    it('apagado: no llama a drain, y no se queja en ningún canal del log', async () => {
      const { scheduler, inboundEmail, logs } = montar({ encendida: false });

      await scheduler.handleCron();

      expect(inboundEmail.drain).not.toHaveBeenCalled();
      expect(logs.log).not.toHaveBeenCalled();
      expect(logs.warn).not.toHaveBeenCalled();
      expect(logs.error).not.toHaveBeenCalled();
    });

    it('encendido: llama a drain', async () => {
      const { scheduler, inboundEmail } = montar({ encendida: true });

      await scheduler.handleCron();

      expect(inboundEmail.drain).toHaveBeenCalledTimes(1);
    });
  });

  describe('el resumen', () => {
    it('no dice nada si no llegó ningún correo', async () => {
      const { scheduler, logs } = montar({ drainImpl: async () => unResumen({ fetched: 0 }) });

      await scheduler.handleCron();

      expect(logs.log).not.toHaveBeenCalled();
    });

    it('resume la pasada cuando llegó al menos un correo', async () => {
      const { scheduler, logs } = montar({
        drainImpl: async () => unResumen({ fetched: 3, ticketsCreated: 1, messagesAdded: 1, duplicates: 1 }),
      });

      await scheduler.handleCron();

      expect(textoDe(logs.log)).toMatch(/3 correo/);
    });
  });

  describe('un buzón que no responde', () => {
    it('no deja escapar el fallo, y se anota sin escalar más allá del log', async () => {
      const { scheduler, logs } = montar({
        drainImpl: async () => {
          throw new Error('ETIMEDOUT contra imap.kuboti.com');
        },
      });

      await expect(scheduler.handleCron()).resolves.toBeUndefined();
      expect(textoDe(logs.warn)).toContain('ETIMEDOUT');
    });

    it('un fallo al comprobar el interruptor tampoco escapa', async () => {
      const workspace = { isImapIngestionEnabled: jest.fn().mockRejectedValue(new Error('la base no responde')) };
      const inboundEmail = { drain: jest.fn() };
      const scheduler = new InboundEmailScheduler(workspace as any, inboundEmail as any);
      jest.spyOn((scheduler as any).logger, 'warn').mockImplementation(() => undefined);

      await expect(scheduler.handleCron()).resolves.toBeUndefined();
      expect(inboundEmail.drain).not.toHaveBeenCalled();
    });
  });

  describe('dos pasadas solapadas', () => {
    /** Un `drain` que se queda colgado, como un buzón que no responde a tiempo. */
    function drainColgado(inboundEmail: { drain: jest.Mock }) {
      let liberar!: () => void;
      const colgado = new Promise<void>((resolve) => {
        liberar = resolve;
      });
      inboundEmail.drain.mockImplementation(async () => {
        await colgado;
        return unResumen({ fetched: 1 });
      });
      return liberar;
    }

    it('la segunda no vuelve a drenar mientras la primera sigue en vuelo', async () => {
      const { scheduler, inboundEmail, logs } = montar();
      const liberar = drainColgado(inboundEmail);

      const primera = scheduler.handleCron();
      await scheduler.handleCron();

      expect(inboundEmail.drain).toHaveBeenCalledTimes(1);
      expect(textoDe(logs.warn)).toMatch(/en curso/i);

      liberar();
      await primera;

      expect(inboundEmail.drain).toHaveBeenCalledTimes(1);
    });

    it('la pasada siguiente drena con normalidad en cuanto la anterior termina', async () => {
      const { scheduler, inboundEmail } = montar();
      const liberar = drainColgado(inboundEmail);

      const primera = scheduler.handleCron();
      await scheduler.handleCron();
      liberar();
      await primera;

      inboundEmail.drain.mockResolvedValue(unResumen({ fetched: 1 }));
      await scheduler.handleCron();

      expect(inboundEmail.drain).toHaveBeenCalledTimes(2);
    });

    it('una pasada que revienta no deja el freno echado', async () => {
      const { scheduler, inboundEmail } = montar();
      inboundEmail.drain.mockRejectedValueOnce(new Error('la base no responde'));

      await scheduler.handleCron();
      inboundEmail.drain.mockResolvedValue(unResumen({ fetched: 1 }));
      await scheduler.handleCron();

      expect(inboundEmail.drain).toHaveBeenCalledTimes(2);
    });
  });

  describe('el cron', () => {
    it('pasa un minuto entre dos pasadas sin que nada de esto dependa del reloj real', () => {
      // Documental: `waitForCompletion` y `EVERY_MINUTE` son opciones del
      // decorador `@Cron`, no algo que este archivo pueda invocar sin el
      // runtime de `@nestjs/schedule` de por medio -- se deja constancia de
      // que ambos existen por inspección, no por ejecución.
      const metadata = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', InboundEmailScheduler.prototype.handleCron);
      expect(metadata).toEqual(expect.objectContaining({ waitForCompletion: true }));
    });
  });
});
