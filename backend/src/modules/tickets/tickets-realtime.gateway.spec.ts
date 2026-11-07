import { TicketsRealtimeGateway } from './tickets-realtime.gateway';

const makeGateway = (verify: () => Promise<Record<string, unknown>>) => {
  const jwt = { verifyAsync: jest.fn().mockImplementation(verify) };
  const cfg = { get: jest.fn().mockReturnValue('secreto') };
  const gateway = new TicketsRealtimeGateway(jwt as any, cfg as any);
  const emit = jest.fn();
  (gateway as any).server = { to: jest.fn().mockReturnValue({ emit }) };
  return { gateway, jwt, emit };
};

const makeSocket = (token?: unknown) => ({
  handshake: { auth: token === undefined ? {} : { token } },
  join: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn(),
});

describe('TicketsRealtimeGateway: quién se conecta', () => {
  it('un token del personal entra a la sala del equipo', async () => {
    const { gateway, jwt } = makeGateway(async () => ({ sub: 1, role: 'ADMIN' }));
    const socket = makeSocket('tok');

    await gateway.handleConnection(socket as any);

    expect(jwt.verifyAsync).toHaveBeenCalledWith('tok', { secret: 'secreto' });
    expect(socket.join).toHaveBeenCalledWith('staff');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('sin token se corta', async () => {
    const { gateway } = makeGateway(async () => ({ sub: 1 }));
    const socket = makeSocket();

    await gateway.handleConnection(socket as any);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('un token inválido o vencido se corta', async () => {
    const { gateway } = makeGateway(async () => {
      throw new Error('jwt expired');
    });
    const socket = makeSocket('tok');

    await gateway.handleConnection(socket as any);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('un payload con identidad de cliente se corta aunque traiga rol', async () => {
    const { gateway } = makeGateway(async () => ({ sub: 3, role: 'ADMIN', clientId: 7 }));
    const socket = makeSocket('tok');

    await gateway.handleConnection(socket as any);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });
});

describe('TicketsRealtimeGateway: qué emite', () => {
  it('un ticket nuevo avisa con lo justo y pide recargar la bandeja', () => {
    const { gateway, emit } = makeGateway(async () => ({}));

    gateway.notifyCreated({
      id: 6, code: 'KB-0006', subject: 'Error', priority: 'P3', origin: 'PORTAL', rawText: 'no viaja',
    } as any);

    expect(emit).toHaveBeenCalledWith('ticket:created', {
      id: 6, code: 'KB-0006', subject: 'Error', priority: 'P3', origin: 'PORTAL',
    });
    expect(emit).toHaveBeenCalledWith('tickets:changed', {});
  });

  it('sin servidor montado no revienta', () => {
    const { gateway } = makeGateway(async () => ({}));
    (gateway as any).server = undefined;

    expect(() => gateway.notifyChanged()).not.toThrow();
  });
});

// Socket simulado con salas y datos, como el Namespace real expone `sockets`.
const makeLiveSocket = (id: string, rooms: string[] = ['staff']) => {
  const set = new Set<string>(rooms);
  return {
    id,
    rooms: set,
    data: {} as Record<string, any>,
    emit: jest.fn(),
    join: jest.fn().mockImplementation(async (r: string) => { set.add(r); }),
    leave: jest.fn().mockImplementation(async (r: string) => { set.delete(r); }),
  };
};

const makeLiveGateway = (sockets: ReturnType<typeof makeLiveSocket>[]) => {
  const { gateway, emit } = makeGateway(async () => ({}));
  const to = jest.fn().mockReturnValue({ emit });
  (gateway as any).server = { to, sockets: new Map(sockets.map((s) => [s.id, s])) };
  return { gateway, emit, to };
};

const logLine = (o: Record<string, unknown> = {}) => ({
  ts: '2026-11-07T10:00:00.000Z', nivel: 'ERROR', instalacionId: 1, clienteId: null, sistemaId: null,
  aplicativo: 'App', servidor: 'S1', logger: 'L', mensaje: 'm', excepcion: null, hilo: null, ...o,
});

describe('TicketsRealtimeGateway: logs en vivo', () => {
  it('un logs:subscribe antes de entrar en staff se ignora', () => {
    const s = makeLiveSocket('a', []);
    const { gateway } = makeLiveGateway([s]);

    expect(gateway.subscribeLogs(s as any, {})).toEqual({ ok: false });
    expect(s.join).not.toHaveBeenCalled();
    expect(s.rooms.has('logs-live')).toBe(false);
  });

  it('guarda el filtro saneado y se une a logs-live', () => {
    const s = makeLiveSocket('a');
    const { gateway } = makeLiveGateway([s]);

    const r = gateway.subscribeLogs(s as any, { aplicativo: ' App ', nivelMinimo: 'basura', x: 1 });

    expect(r).toEqual({ ok: true });
    expect(s.data.logFilter).toEqual({ aplicativo: 'App' });
    expect(s.join).toHaveBeenCalledWith('logs-live');
  });

  it('publishLogLines solo manda a cada socket lo que casa con su filtro', () => {
    const a = makeLiveSocket('a', ['staff', 'logs-live']);
    a.data.logFilter = { aplicativo: 'A' };
    const b = makeLiveSocket('b', ['staff', 'logs-live']);
    b.data.logFilter = { aplicativo: 'B' };
    const c = makeLiveSocket('c', ['staff']); // en staff pero sin suscribirse
    const { gateway } = makeLiveGateway([a, b, c]);

    gateway.publishLogLines([logLine({ aplicativo: 'A' }), logLine({ aplicativo: 'B' })] as any, 1000);

    expect(a.emit).toHaveBeenCalledWith('logs:lines', { lines: [logLine({ aplicativo: 'A' })], omitidas: 0 });
    expect(b.emit).toHaveBeenCalledWith('logs:lines', { lines: [logLine({ aplicativo: 'B' })], omitidas: 0 });
    expect(c.emit).not.toHaveBeenCalled();
  });

  it('con 500 líneas en un segundo un socket recibe 200 y omitidas 300', () => {
    const a = makeLiveSocket('a', ['staff', 'logs-live']);
    a.data.logFilter = {};
    const { gateway } = makeLiveGateway([a]);

    gateway.publishLogLines(Array.from({ length: 500 }, () => logLine()) as any, 5000);

    const [, payload] = a.emit.mock.calls[0];
    expect(payload.lines).toHaveLength(200);
    expect(payload.omitidas).toBe(300);
  });

  it('un socket que se dio de baja no recibe nada', () => {
    const a = makeLiveSocket('a');
    const { gateway } = makeLiveGateway([a]);
    gateway.subscribeLogs(a as any, {});

    expect(gateway.unsubscribeLogs(a as any)).toEqual({ ok: true });
    gateway.publishLogLines([logLine()] as any, 1000);

    expect(a.leave).toHaveBeenCalledWith('logs-live');
    expect(a.emit).not.toHaveBeenCalled();
  });

  it('un socket suscrito sin sala staff nunca recibe líneas', () => {
    const a = makeLiveSocket('a', ['logs-live']);
    a.data.logFilter = {};
    const { gateway } = makeLiveGateway([a]);

    gateway.publishLogLines([logLine()] as any, 1000);

    expect(a.emit).not.toHaveBeenCalled();
  });

  it('notifyErrorNew emite error:new y errors:changed a staff', () => {
    const { gateway, emit, to } = makeLiveGateway([]);
    const p = { id: 4, title: 'Boom', aplicativo: 'App', clienteNombre: null, reopened: false, reason: null };

    gateway.notifyErrorNew(p);

    expect(to).toHaveBeenCalledWith('staff');
    expect(emit).toHaveBeenCalledWith('error:new', p);
    expect(emit).toHaveBeenCalledWith('errors:changed', {});
  });

  it('notifyDiskAlert emite monitoreo:disco a staff', () => {
    const { gateway, emit } = makeLiveGateway([]);
    gateway.notifyDiskAlert({ usedPct: 91, threshold: 85 });
    expect(emit).toHaveBeenCalledWith('monitoreo:disco', { usedPct: 91, threshold: 85 });
  });

  it('publicar nunca lanza aunque el servidor no esté montado', () => {
    const { gateway } = makeLiveGateway([]);
    (gateway as any).server = undefined;

    expect(() => gateway.publishLogLines([logLine()] as any)).not.toThrow();
    expect(() => gateway.notifyErrorsChanged()).not.toThrow();
    expect(() => gateway.notifyDiskAlert({ usedPct: 1, threshold: 2 })).not.toThrow();
    (gateway as any).server = { to: () => { throw new Error('x'); }, sockets: { values: () => { throw new Error('y'); } } };
    expect(() => gateway.publishLogLines([logLine()] as any)).not.toThrow();
  });
});
