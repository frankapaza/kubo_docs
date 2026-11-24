import { AvailabilityEvaluatorScheduler } from './availability-evaluator.scheduler';

describe('AvailabilityEvaluatorScheduler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('el tick corre cada 5 s y un tick lento hace que el siguiente se salte', async () => {
    const evaluator = { tick: jest.fn() };
    let release!: () => void;
    evaluator.tick.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    evaluator.tick.mockResolvedValue(undefined);
    const s = new AvailabilityEvaluatorScheduler(evaluator as any);
    s.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5000);
    expect(evaluator.tick).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10000);
    expect(evaluator.tick).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(5000);
    expect(evaluator.tick).toHaveBeenCalledTimes(2);
    s.onApplicationShutdown();
  });

  it('una excepción del tick se registra y el siguiente tick se ejecuta', async () => {
    const evaluator = { tick: jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined) };
    const s = new AvailabilityEvaluatorScheduler(evaluator as any);
    s.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(10000);
    expect(evaluator.tick).toHaveBeenCalledTimes(2);
    s.onApplicationShutdown();
  });

  it('al apagar no vuelve a ejecutar', async () => {
    const evaluator = { tick: jest.fn().mockResolvedValue(undefined) };
    const s = new AvailabilityEvaluatorScheduler(evaluator as any);
    s.onApplicationBootstrap();
    s.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(20000);
    expect(evaluator.tick).not.toHaveBeenCalled();
  });
});
