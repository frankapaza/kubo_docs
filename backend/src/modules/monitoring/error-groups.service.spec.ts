import { ErrorGroupsService, ErrorEventInput, OccurrenceContext, fitTextBytes } from './error-groups.service';
import { computeErrorFingerprint } from './domain/error-fingerprint';

const AHORA = new Date('2026-11-07T15:00:00.000Z');

/**
 * Repositorio en memoria por huella: lo justo para que el bloqueo, el alta y
 * el choque con la clave única se ejerzan de verdad en el servicio. Las
 * filas imitan a TypeORM: los bigint vuelven como cadena.
 */
const makeService = () => {
  const groups = new Map<string, any>();
  let seq = 0;
  const manager = { tx: true };
  const repo = {
    groups,
    runInTransaction: jest.fn(async (work: (m: any) => Promise<unknown>) => work(manager)),
    lockByFingerprint: jest.fn(async (_m: any, fp: string) => groups.get(fp) ?? null),
    insertGroup: jest.fn(async (_m: any, data: any) => {
      groups.set(data.fingerprint, { ...data, id: String(++seq) });
    }),
    applyBatch: jest.fn().mockResolvedValue(undefined),
    insertOccurrences: jest.fn().mockResolvedValue(undefined),
    trimOccurrences: jest.fn().mockResolvedValue(undefined),
    addDaily: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    countByStatus: jest.fn().mockResolvedValue(0),
    findRowById: jest.fn().mockResolvedValue(null),
    listOccurrences: jest.fn().mockResolvedValue([]),
    dailySince: jest.fn().mockResolvedValue([]),
  };
  const tickets = { findById: jest.fn().mockResolvedValue(null) };
  const clients = { findById: jest.fn(async (id: number) => (Number(id) === 7 ? { id: '7', razonSocial: 'ACME SAC' } : null)) };
  const gateway = { notifyErrorNew: jest.fn(), notifyErrorsChanged: jest.fn() };
  const service = new ErrorGroupsService(repo as any, tickets as any, clients as any, gateway as any);
  return { service, repo, tickets, clients, gateway, manager };
};

const ctx: OccurrenceContext = {
  installationId: 4,
  aplicativo: 'Facturador',
  servidor: 'SRV-01',
  receivedAt: AHORA,
};

const ev = (over: Partial<ErrorEventInput> = {}): ErrorEventInput => ({
  at: new Date('2026-11-07T14:00:00.000Z'),
  clientId: 7,
  systemId: 3,
  nivel: 'ERROR',
  logger: 'Kubo.Facturador.Envio',
  mensaje: 'No se pudo enviar el comprobante 123',
  excepcion: 'System.InvalidOperationException: boom\n   at Kubo.Facturador.Envio.Run() in C:\\src\\Envio.cs:line 10',
  hilo: '5',
  propiedades: {},
  ...over,
});

const huellaDe = (e: ErrorEventInput, clienteKey: string, sistemaKey: string) =>
  computeErrorFingerprint({
    clienteKey,
    sistemaKey,
    aplicativo: ctx.aplicativo,
    logger: e.logger,
    mensaje: e.mensaje,
    excepcion: e.excepcion,
  }).fingerprint;

/** Siembra un grupo ya existente para la huella del evento de cliente 7 / sistema 3. */
const sembrar = (repo: any, over: any) => {
  const fp = huellaDe(ev(), '7', '3');
  const g = {
    id: '9',
    fingerprint: fp,
    title: 'System.InvalidOperationException: No se pudo enviar el comprobante 123',
    aplicativo: ctx.aplicativo,
    clientId: '7',
    systemId: '3',
    servers: ['SRV-01'],
    status: 'NUEVO',
    resolvedAt: null,
    ticketId: null,
    ...over,
  };
  repo.groups.set(fp, g);
  return g;
};

beforeEach(() => {
  jest.useFakeTimers({ now: AHORA });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('ErrorGroupsService.recordOccurrences', () => {
  it('tres eventos con la misma huella en un lote son un grupo con tres ocurrencias y un solo aviso', async () => {
    const { service, repo, gateway } = makeService();
    await service.recordOccurrences(ctx, [ev(), ev({ mensaje: 'No se pudo enviar el comprobante 456' }), ev()]);

    expect(repo.insertGroup).toHaveBeenCalledTimes(1);
    expect(repo.runInTransaction).toHaveBeenCalledTimes(1);
    expect(repo.applyBatch).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ count: 3 }));
    expect(repo.insertOccurrences.mock.calls[0][1]).toHaveLength(3);
    expect(gateway.notifyErrorNew).toHaveBeenCalledTimes(1);
  });

  it('un grupo nuevo avisa con error:new y uno que sigue NUEVO no', async () => {
    const { service, gateway } = makeService();
    await service.recordOccurrences(ctx, [ev()]);
    expect(gateway.notifyErrorNew).toHaveBeenCalledWith({
      id: 1,
      title: 'System.InvalidOperationException: No se pudo enviar el comprobante 123',
      aplicativo: 'Facturador',
      clienteNombre: 'ACME SAC',
      reopened: false,
      reason: null,
    });

    await service.recordOccurrences(ctx, [ev({ at: new Date('2026-11-07T14:30:00.000Z') })]);
    expect(gateway.notifyErrorNew).toHaveBeenCalledTimes(1);
  });

  it('un RESUELTO que vuelve pasa a NUEVO, guarda reopened_at y el motivo, y avisa con reopened', async () => {
    const { service, repo, gateway } = makeService();
    sembrar(repo, { status: 'RESUELTO', resolvedAt: new Date('2026-11-07T10:00:00.000Z') });

    await service.recordOccurrences(ctx, [ev()]);

    expect(repo.insertGroup).not.toHaveBeenCalled();
    expect(repo.applyBatch).toHaveBeenCalledWith(
      expect.anything(),
      9,
      expect.objectContaining({
        status: 'NUEVO',
        reopen: { at: AHORA, reason: 'Reapareció después de marcarse como resuelto' },
      }),
    );
    expect(gateway.notifyErrorNew).toHaveBeenCalledWith(
      expect.objectContaining({ id: 9, reopened: true, reason: 'Reapareció después de marcarse como resuelto' }),
    );
  });

  it('un CON_TICKET con el ticket abierto solo suma', async () => {
    const { service, repo, tickets, gateway } = makeService();
    sembrar(repo, { status: 'CON_TICKET', ticketId: '12' });
    tickets.findById.mockResolvedValue({ id: '12', code: 'KB-0012', status: 'EN_ATENCION', resolvedAt: null, closedAt: null });

    await service.recordOccurrences(ctx, [ev(), ev()]);

    expect(repo.applyBatch).toHaveBeenCalledWith(
      expect.anything(),
      9,
      expect.objectContaining({ status: 'CON_TICKET', count: 2, reopen: null }),
    );
    expect(gateway.notifyErrorNew).not.toHaveBeenCalled();
  });

  it('con el ticket RESUELTO antes de la ocurrencia se reabre con «Reapareció tras el ticket KB-0012»', async () => {
    const { service, repo, tickets, gateway } = makeService();
    sembrar(repo, { status: 'CON_TICKET', ticketId: '12' });
    tickets.findById.mockResolvedValue({
      id: '12',
      code: 'KB-0012',
      status: 'RESUELTO',
      resolvedAt: new Date('2026-11-07T12:00:00.000Z'),
      closedAt: null,
    });

    await service.recordOccurrences(ctx, [ev()]);

    expect(tickets.findById).toHaveBeenCalledWith(12);
    expect(repo.applyBatch).toHaveBeenCalledWith(
      expect.anything(),
      9,
      expect.objectContaining({ status: 'NUEVO', reopen: { at: AHORA, reason: 'Reapareció tras el ticket KB-0012' } }),
    );
    expect(gateway.notifyErrorNew).toHaveBeenCalledWith(
      expect.objectContaining({ reopened: true, reason: 'Reapareció tras el ticket KB-0012' }),
    );
  });

  it('conserva solo las 50 ocurrencias más recientes', async () => {
    const { service, repo } = makeService();
    const base = new Date('2026-11-07T13:00:00.000Z').getTime();
    // Desordenadas a propósito: «las más recientes» es por hora, no por posición.
    const eventos = Array.from({ length: 60 }, (_, i) => ev({ at: new Date(base + ((i * 37) % 60) * 1000) }));

    await service.recordOccurrences(ctx, eventos);

    const insertadas = repo.insertOccurrences.mock.calls[0][1] as any[];
    expect(insertadas).toHaveLength(50);
    const minimo = Math.min(...insertadas.map((o) => o.occurredAt.getTime()));
    expect(minimo).toBe(base + 10 * 1000);
    expect(repo.trimOccurrences).toHaveBeenCalledWith(expect.anything(), 1, 50);
    expect(repo.applyBatch).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ count: 60 }));
  });

  it('servers une sin repetir y con tope de 20', async () => {
    const { service, repo } = makeService();
    sembrar(repo, { servers: ['SRV-00', 'SRV-01'] });
    await service.recordOccurrences(ctx, [ev()]);
    expect(repo.applyBatch.mock.calls[0][2].servers).toEqual(['SRV-00', 'SRV-01']);

    const veinte = Array.from({ length: 20 }, (_, i) => `S${i}`);
    sembrar(repo, { servers: veinte });
    await service.recordOccurrences({ ...ctx, servidor: 'SRV-NUEVO' }, [ev()]);
    expect(repo.applyBatch.mock.calls[1][2].servers).toEqual(veinte);

    sembrar(repo, { servers: ['SRV-00'] });
    await service.recordOccurrences({ ...ctx, servidor: 'SRV-02' }, [ev()]);
    expect(repo.applyBatch.mock.calls[2][2].servers).toEqual(['SRV-00', 'SRV-02']);
  });

  it('cuenta por día de Perú', async () => {
    const { service, repo } = makeService();
    await service.recordOccurrences({ ...ctx, receivedAt: new Date('2026-11-08T03:05:00.000Z') }, [
      ev({ at: new Date('2026-11-08T03:00:00.000Z') }),
      ev({ at: new Date('2026-11-08T06:00:00.000Z') }),
    ]);
    expect(repo.addDaily).toHaveBeenCalledWith(expect.anything(), 1, [
      { day: '2026-11-07', count: 1 },
      { day: '2026-11-08', count: 1 },
    ]);
  });

  it('una instalación interna sin RUC usa interno en la huella', async () => {
    const { service, repo, gateway } = makeService();
    const e = ev({ clientId: null, systemId: null });
    await service.recordOccurrences(ctx, [e]);
    const data = repo.insertGroup.mock.calls[0][1];
    expect(data.fingerprint).toBe(huellaDe(e, 'interno', 'ninguno'));
    expect(data.clientId).toBeNull();
    expect(gateway.notifyErrorNew).toHaveBeenCalledWith(expect.objectContaining({ clienteNombre: null }));
  });

  it('con cliente resuelto usa ese cliente', async () => {
    const { service, repo } = makeService();
    const e = ev({ clientId: 7, systemId: 3 });
    await service.recordOccurrences(ctx, [e]);
    const data = repo.insertGroup.mock.calls[0][1];
    expect(data.fingerprint).toBe(huellaDe(e, '7', '3'));
    expect(data).toMatchObject({ clientId: 7, systemId: 3, installationId: 4 });
  });

  it('si el INSERT del grupo choca con la clave única (otro lote lo creó a la vez), recarga y actualiza', async () => {
    const { service, repo, gateway } = makeService();
    repo.insertGroup.mockImplementationOnce(async (_m: any, data: any) => {
      // El otro lote ganó la carrera: su fila ya existe cuando este relee.
      repo.groups.set(data.fingerprint, { ...data, id: '33', status: 'NUEVO', servers: ['SRV-01'] });
      throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    });

    await service.recordOccurrences(ctx, [ev()]);

    expect(repo.lockByFingerprint).toHaveBeenCalledTimes(2);
    expect(repo.applyBatch).toHaveBeenCalledWith(expect.anything(), 33, expect.objectContaining({ count: 1 }));
    // El aviso de «nuevo» ya lo dio el lote que lo creó.
    expect(gateway.notifyErrorNew).not.toHaveBeenCalled();
  });

  it('avisa después del commit y no si la transacción falla', async () => {
    const { service, repo, gateway } = makeService();
    repo.addDaily.mockRejectedValueOnce(new Error('se cayó MySQL'));
    await expect(service.recordOccurrences(ctx, [ev()])).rejects.toThrow('se cayó MySQL');
    expect(gateway.notifyErrorNew).not.toHaveBeenCalled();
  });

  it('errors:changed como mucho cada 5 s, sin perder el último cambio', async () => {
    const { service, repo, gateway } = makeService();
    sembrar(repo, {});
    await service.recordOccurrences(ctx, [ev()]);
    expect(gateway.notifyErrorsChanged).toHaveBeenCalledTimes(1);

    await service.recordOccurrences(ctx, [ev()]);
    await service.recordOccurrences(ctx, [ev()]);
    expect(gateway.notifyErrorsChanged).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5000);
    expect(gateway.notifyErrorsChanged).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });
});

describe('ErrorGroupsService lectura', () => {
  it('list filtra por cliente interno con client_id IS NULL', async () => {
    const { service, repo } = makeService();
    await service.list({ cliente: 'interno' });
    const [where, , limit, offset] = repo.list.mock.calls[0];
    expect(where.clauses).toContain('g.client_id IS NULL');
    expect(where.params).toEqual([]);
    expect(limit).toBe(25);
    expect(offset).toBe(0);

    await service.list({ cliente: '7', page: 3, pageSize: 10 });
    const [where2, , limit2, offset2] = repo.list.mock.calls[1];
    expect(where2.clauses).toContain('g.client_id = ?');
    expect(where2.params).toEqual([7]);
    expect([limit2, offset2]).toEqual([10, 20]);
  });

  it('ordena por cantidad', async () => {
    const { service, repo } = makeService();
    await service.list({ orden: 'cantidad' });
    expect(repo.list.mock.calls[0][1]).toMatch(/^g\.occurrences_total DESC/);
    await service.list({});
    expect(repo.list.mock.calls[1][1]).toMatch(/^g\.last_seen_at DESC/);
  });

  it('list proyecta con lista blanca y fechas ISO', async () => {
    const { service, repo } = makeService();
    repo.list.mockResolvedValue({
      total: 1,
      rows: [
        {
          id: '9', title: 'T', exception_type: null, aplicativo: 'A', logger: 'L', installation_id: '4',
          client_id: null, client_name: null, system_id: '3', system_name: 'ERP',
          status: 'CON_TICKET', first_seen_at: new Date('2026-11-01T00:00:00Z'),
          last_seen_at: new Date('2026-11-07T00:00:00Z'), occurrences_total: '12', servers: '["S1"]',
          reopened_at: null, reopen_reason: null, ticket_id: '12', ticket_code: 'KB-0012',
          ticket_status: 'EN_ATENCION', resolved_at: null, resolved_by_name: null, resolution_note: null,
          fingerprint: 'no-debe-salir',
        },
      ],
    });
    const { items, total } = await service.list({});
    expect(total).toBe(1);
    expect(items[0]).toEqual({
      id: 9, title: 'T', exceptionType: null, aplicativo: 'A', logger: 'L', installationId: 4,
      clientId: null, clientName: null, systemId: 3, systemName: 'ERP', status: 'CON_TICKET',
      firstSeenAt: '2026-11-01T00:00:00.000Z', lastSeenAt: '2026-11-07T00:00:00.000Z',
      occurrencesTotal: 12, servers: ['S1'], reopenedAt: null, reopenReason: null,
      ticket: { id: 12, code: 'KB-0012', status: 'EN_ATENCION' },
      resolvedAt: null, resolvedByName: null, resolutionNote: null,
    });
  });

  it('summary cuenta los NUEVO', async () => {
    const { service, repo } = makeService();
    repo.countByStatus.mockResolvedValue(4);
    await expect(service.summary()).resolves.toEqual({ nuevos: 4 });
    expect(repo.countByStatus).toHaveBeenCalledWith('NUEVO');
  });

  it('detail rellena con ceros los días sin ocurrencias', async () => {
    const { service, repo } = makeService();
    repo.findRowById.mockResolvedValue({
      id: '9', title: 'T', exception_type: null, aplicativo: 'A', logger: 'L', installation_id: '4',
      client_id: '7', client_name: 'ACME SAC', system_id: null, system_name: null, status: 'NUEVO',
      first_seen_at: new Date('2026-11-01T00:00:00Z'), last_seen_at: new Date('2026-11-07T00:00:00Z'),
      occurrences_total: 4, servers: ['S1'], reopened_at: null, reopen_reason: null, ticket_id: null,
      ticket_code: null, ticket_status: null, resolved_at: null, resolved_by_name: null, resolution_note: null,
    });
    repo.dailySince.mockResolvedValue([{ day: '2026-11-05', count: '4' }]);
    repo.listOccurrences.mockResolvedValue([
      {
        id: '100', occurred_at: new Date('2026-11-05T10:00:00Z'), servidor: 'S1', hilo: null, logger: 'L',
        message: 'm', exception: null, properties: { k: 'v' },
      },
    ]);

    const d = await service.detail(9);

    expect(repo.dailySince).toHaveBeenCalledWith(9, '2026-10-09');
    expect(d.daily).toHaveLength(30);
    expect(d.daily[0]).toEqual({ day: '2026-10-09', count: 0 });
    expect(d.daily[29]).toEqual({ day: '2026-11-07', count: 0 });
    expect(d.daily.find((x) => x.day === '2026-11-05')).toEqual({ day: '2026-11-05', count: 4 });
    expect(d.occurrences).toEqual([
      {
        id: 100, occurredAt: '2026-11-05T10:00:00.000Z', servidor: 'S1', hilo: null, logger: 'L',
        message: 'm', exception: null, properties: { k: 'v' },
      },
    ]);
    expect(d.ticket).toBeNull();
    expect(repo.listOccurrences).toHaveBeenCalledWith(9, 50);
  });

  it('detail de un id inexistente es 404', async () => {
    const { service } = makeService();
    await expect(service.detail(77)).rejects.toMatchObject({ status: 404 });
  });
});

describe('fitTextBytes', () => {
  it('recorta a 65535 bytes sin partir un carácter y deja intacto lo que cabe', () => {
    expect(fitTextBytes('hola')).toBe('hola');
    const largo = 'a' + 'ñ'.repeat(32768);
    const r = fitTextBytes(largo);
    expect(Buffer.byteLength(r, 'utf8')).toBeLessThanOrEqual(65535);
    expect(r.endsWith('ñ')).toBe(true);
    expect(r).not.toContain('�');
  });
});
