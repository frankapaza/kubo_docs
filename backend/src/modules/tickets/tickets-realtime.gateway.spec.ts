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
