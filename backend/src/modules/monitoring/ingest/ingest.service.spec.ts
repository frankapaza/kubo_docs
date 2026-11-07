import { HttpException } from '@nestjs/common';

import { ResolvedInstallation } from '../installations.service';
import { LokiStream } from '../loki/loki.client';
import { IngestRateLimiter, INGEST_MAX_BATCHES_PER_WINDOW } from './ingest-rate-limiter';
import { IngestService } from './ingest.service';
import { RecentBatches } from './recent-batches';

const AHORA = new Date('2026-11-07T15:00:00.000Z');
const HACE_UN_MINUTO = '2026-11-07T14:59:00.000Z';

const interna = (over: Partial<ResolvedInstallation> = {}): ResolvedInstallation => ({
  id: 9,
  kind: 'INTERNA',
  clientId: null,
  systemId: 4,
  minLevel: 'INFO',
  displayName: 'Integraciones Kubo',
  ...over,
});

const deCliente = (over: Partial<ResolvedInstallation> = {}): ResolvedInstallation => ({
  id: 3,
  kind: 'CLIENTE',
  clientId: 7,
  systemId: 2,
  minLevel: 'INFO',
  displayName: 'ACME · Facturador',
  ...over,
});

const evento = (over: Record<string, unknown> = {}) => ({
  ts: HACE_UN_MINUTO,
  nivel: 'INFO',
  logger: 'App.Servicio',
  mensaje: 'hola',
  ...over,
});

const lote = (over: Record<string, unknown> = {}) => ({
  loteId: 'a1b2c3d4-0000-0000-0000-000000000001',
  aplicativo: 'Facturador',
  servidor: 'SRV-01',
  appenderVersion: '1.0.0',
  descartados: 0,
  eventos: [evento()],
  ...over,
});

const makeService = () => {
  const pushed: LokiStream[][] = [];
  const loki = {
    push: jest.fn(async (streams: LokiStream[]): Promise<any> => {
      pushed.push(streams);
      return { ok: true };
    }),
  };
  const installations = { touchSource: jest.fn().mockResolvedValue(undefined) };
  const errors = { recordOccurrences: jest.fn().mockResolvedValue(undefined) };
  const clients = {
    findByRuc: jest.fn(async (ruc: string) =>
      ruc === '20100000001' ? { id: '15', ruc } : ruc === '20100000002' ? { id: '16', ruc } : null,
    ),
  };
  const gateway = { publishLogLines: jest.fn() };
  const limiter = new IngestRateLimiter();
  const recent = new RecentBatches();
  const service = new IngestService(
    loki as any,
    installations as any,
    errors as any,
    clients as any,
    gateway as any,
    limiter,
    recent,
  );
  return { service, loki, pushed, installations, errors, clients, gateway, limiter, recent };
};

/** Todas las entradas de todos los streams de un push, con sus etiquetas. */
const entradas = (streams: LokiStream[]) =>
  streams.flatMap((s) => s.entries.map((e) => ({ labels: s.labels, at: e.at, line: JSON.parse(e.line) })));

const statusOf = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
    return 202;
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
};

describe('IngestService', () => {
  it('descarta lo que está por debajo del nivel mínimo y lo cuenta', async () => {
    const { service, pushed } = makeService();
    const r = await service.ingest(
      interna({ minLevel: 'WARN' }),
      lote({
        eventos: [evento({ nivel: 'DEBUG' }), evento({ nivel: 'INFO' }), evento({ nivel: 'WARN' }), evento({ nivel: 'ERROR' })],
      }),
      AHORA,
    );
    expect(r).toEqual({ aceptados: 2, descartadosPorNivel: 2 });
    expect(entradas(pushed[0]).map((e) => e.labels.nivel).sort()).toEqual(['ERROR', 'WARN']);
  });

  it('una instalación de cliente ignora kubo:ruc', async () => {
    const { service, pushed, clients } = makeService();
    await service.ingest(deCliente(), lote({ eventos: [evento({ propiedades: { 'kubo:ruc': '20100000001' } })] }), AHORA);
    expect(clients.findByRuc).not.toHaveBeenCalled();
    expect(entradas(pushed[0])[0].labels.cliente).toBe('7');
    expect(entradas(pushed[0])[0].labels.sistema).toBe('2');
  });

  it('una interna resuelve kubo:ruc contra clients.ruc y consulta cada RUC una vez por lote', async () => {
    const { service, pushed, clients, errors } = makeService();
    await service.ingest(
      interna(),
      lote({
        eventos: [
          evento({ propiedades: { 'kubo:ruc': '20100000001' } }),
          evento({ propiedades: { 'kubo:ruc': '20100000001' } }),
          evento({ nivel: 'ERROR', propiedades: { 'kubo:ruc': '20100000002' } }),
          evento(),
        ],
      }),
      AHORA,
    );
    expect(clients.findByRuc).toHaveBeenCalledTimes(2);
    const clientes = entradas(pushed[0]).map((e) => e.labels.cliente).sort();
    expect(clientes).toEqual(['15', '15', '16', 'interno']);
    // El sistema de una interna es el suyo (opcional), no el del cliente.
    expect(entradas(pushed[0]).every((e) => e.labels.sistema === '4')).toBe(true);
    // El grupo de error también queda con el cliente resuelto.
    expect(errors.recordOccurrences.mock.calls[0][1][0]).toMatchObject({ clientId: 16, systemId: 4 });
  });

  it('un RUC desconocido queda como interno y no se rechaza', async () => {
    const { service, pushed } = makeService();
    const r = await service.ingest(
      interna({ systemId: null }),
      lote({ eventos: [evento({ propiedades: { 'kubo:ruc': '99999999999' } })] }),
      AHORA,
    );
    expect(r.aceptados).toBe(1);
    expect(entradas(pushed[0])[0].labels).toMatchObject({ cliente: 'interno', sistema: 'ninguno' });
  });

  it('agrupa en streams por etiquetas', async () => {
    const { service, pushed } = makeService();
    await service.ingest(
      deCliente(),
      lote({
        eventos: [
          evento({ nivel: 'INFO', mensaje: 'a' }),
          evento({ nivel: 'INFO', mensaje: 'b' }),
          evento({ nivel: 'ERROR', mensaje: 'c', excepcion: 'System.Exception: c', hilo: '12', propiedades: { k: 'v' } }),
        ],
      }),
      AHORA,
    );
    const streams = pushed[0];
    // Un solo stream por conjunto de etiquetas (el cliente de Loki resuelve las colisiones de ns por stream).
    expect(streams).toHaveLength(2);
    const info = streams.find((s) => s.labels.nivel === 'INFO')!;
    expect(info.labels).toEqual({
      cliente: '7',
      sistema: '2',
      nivel: 'INFO',
      instalacion: '3',
      aplicativo: 'Facturador',
      servidor: 'SRV-01',
    });
    expect(info.entries).toHaveLength(2);
    const error = streams.find((s) => s.labels.nivel === 'ERROR')!;
    expect(JSON.parse(error.entries[0].line)).toEqual({
      logger: 'App.Servicio',
      mensaje: 'c',
      excepcion: 'System.Exception: c',
      hilo: '12',
      propiedades: { k: 'v' },
    });
    expect(error.entries[0].at.toISOString()).toBe(HACE_UN_MINUTO);
  });

  it('un ts fuera de ventana usa la hora de recepción y guarda tsOriginal en la línea', async () => {
    const { service, pushed, errors } = makeService();
    await service.ingest(
      deCliente(),
      lote({ eventos: [evento({ ts: '2026-10-01T00:00:00Z', nivel: 'ERROR' }), evento({ ts: '2027-01-01T00:00:00Z' })] }),
      AHORA,
    );
    const es = entradas(pushed[0]);
    expect(es.every((e) => e.at.getTime() === AHORA.getTime())).toBe(true);
    expect(es.map((e) => e.line.tsOriginal).sort()).toEqual(['2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z']);
    expect(errors.recordOccurrences.mock.calls[0][1][0].at.getTime()).toBe(AHORA.getTime());
  });

  it('si el appender descartó eventos, escribe una línea WARN que lo dice', async () => {
    const { service, pushed } = makeService();
    const r = await service.ingest(deCliente({ minLevel: 'ERROR' }), lote({ descartados: 37, eventos: [] }), AHORA);
    expect(r).toEqual({ aceptados: 0, descartadosPorNivel: 0 });
    const es = entradas(pushed[0]);
    expect(es).toHaveLength(1);
    expect(es[0].labels.nivel).toBe('WARN');
    expect(es[0].line.mensaje).toContain('37');
    expect(es[0].at.getTime()).toBe(AHORA.getTime());
  });

  it('Loki reintentable → 503, pero los errores se registran', async () => {
    const { service, loki, errors, installations } = makeService();
    loki.push.mockResolvedValueOnce({ ok: false, retryable: true, status: 503, message: 'down' });
    const status = await statusOf(service.ingest(deCliente(), lote({ eventos: [evento({ nivel: 'ERROR' })] }), AHORA));
    expect(status).toBe(503);
    expect(errors.recordOccurrences).toHaveBeenCalledTimes(1);
    expect(installations.touchSource).toHaveBeenCalled();
  });

  it('Loki 400 → se registra y responde normal, nunca 503', async () => {
    const { service, loki, errors } = makeService();
    loki.push.mockResolvedValueOnce({ ok: false, retryable: false, status: 400, message: 'entry too far behind' });
    const r = await service.ingest(deCliente(), lote({ eventos: [evento({ nivel: 'ERROR' })] }), AHORA);
    expect(r.aceptados).toBe(1);
    expect(errors.recordOccurrences).toHaveBeenCalledTimes(1);
  });

  it('un lote reintentado con el mismo loteId no vuelve a sumar ocurrencias ni a publicar en vivo, pero sí reintenta Loki', async () => {
    const { service, loki, errors, gateway } = makeService();
    loki.push.mockResolvedValueOnce({ ok: false, retryable: true, status: null, message: 'timeout' });
    const body = lote({ eventos: [evento({ nivel: 'ERROR' })] });
    expect(await statusOf(service.ingest(deCliente(), body, AHORA))).toBe(503);
    const r = await service.ingest(deCliente(), body, new Date(AHORA.getTime() + 5000));
    expect(r.aceptados).toBe(1);
    expect(loki.push).toHaveBeenCalledTimes(2);
    expect(errors.recordOccurrences).toHaveBeenCalledTimes(1);
    expect(gateway.publishLogLines).toHaveBeenCalledTimes(1);
  });

  it('si registrar los errores falla → 503 y el reintento los vuelve a registrar', async () => {
    const { service, errors } = makeService();
    errors.recordOccurrences.mockRejectedValueOnce(new Error('ER_LOCK_WAIT_TIMEOUT'));
    const body = lote({ eventos: [evento({ nivel: 'ERROR' })] });
    expect(await statusOf(service.ingest(deCliente(), body, AHORA))).toBe(503);
    await service.ingest(deCliente(), body, AHORA);
    expect(errors.recordOccurrences).toHaveBeenCalledTimes(2);
  });

  it('dos envíos simultáneos del mismo loteId registran los errores una sola vez', async () => {
    const { service, errors, loki } = makeService();
    let resolveFirst!: () => void;
    errors.recordOccurrences.mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)));
    const body = lote({ eventos: [evento({ nivel: 'ERROR' })] });
    // El primero se queda esperando un bloqueo de fila; el appender corta y reintenta.
    const first = service.ingest(deCliente(), body, AHORA);
    const second = statusOf(service.ingest(deCliente(), body, new Date(AHORA.getTime() + 5000)));
    // El duplicado en vuelo no registra nada: empuja Loki y pide reintentar (503).
    expect(await second).toBe(503);
    expect(errors.recordOccurrences).toHaveBeenCalledTimes(1);
    expect(loki.push).toHaveBeenCalledTimes(2);
    resolveFirst();
    await expect(first).resolves.toEqual({ aceptados: 1, descartadosPorNivel: 0 });
    // Confirmado: el siguiente reintento ya responde 202 sin volver a sumar.
    await expect(service.ingest(deCliente(), body, AHORA)).resolves.toEqual({ aceptados: 1, descartadosPorNivel: 0 });
    expect(errors.recordOccurrences).toHaveBeenCalledTimes(1);
  });

  it('si el original en vuelo falla, libera el lote y un tercer envío los registra', async () => {
    const { service, errors } = makeService();
    let rejectFirst!: (e: Error) => void;
    errors.recordOccurrences.mockImplementationOnce(() => new Promise<void>((_r, j) => (rejectFirst = j)));
    const body = lote({ eventos: [evento({ nivel: 'ERROR' })] });
    const first = statusOf(service.ingest(deCliente(), body, AHORA));
    expect(await statusOf(service.ingest(deCliente(), body, AHORA))).toBe(503);
    rejectFirst(new Error('ER_LOCK_WAIT_TIMEOUT'));
    expect(await first).toBe(503);
    await expect(service.ingest(deCliente(), body, AHORA)).resolves.toEqual({ aceptados: 1, descartadosPorNivel: 0 });
    expect(errors.recordOccurrences).toHaveBeenCalledTimes(2);
  });

  it('un fallo inesperado antes de registrar no deja el lote reservado', async () => {
    const { service, loki, errors } = makeService();
    loki.push.mockRejectedValueOnce(new Error('inesperado'));
    const body = lote({ eventos: [evento({ nivel: 'ERROR' })] });
    await expect(service.ingest(deCliente(), body, AHORA)).rejects.toThrow('inesperado');
    await service.ingest(deCliente(), body, AHORA);
    expect(errors.recordOccurrences).toHaveBeenCalledTimes(1);
  });

  it('más de 1000 eventos → 413, no 400', async () => {
    const { service, loki } = makeService();
    const eventos = Array.from({ length: 1001 }, () => evento());
    expect(await statusOf(service.ingest(deCliente(), lote({ eventos }), AHORA))).toBe(413);
    expect(loki.push).not.toHaveBeenCalled();
  });

  it('sin loteId (appender antiguo) cada envío se procesa entero', async () => {
    const { service, errors } = makeService();
    const body = lote({ loteId: undefined, eventos: [evento({ nivel: 'ERROR' })] });
    await service.ingest(deCliente(), body, AHORA);
    await service.ingest(deCliente(), body, AHORA);
    expect(errors.recordOccurrences).toHaveBeenCalledTimes(2);
  });

  it('solo ERROR y FATAL van a recordOccurrences', async () => {
    const { service, errors } = makeService();
    await service.ingest(
      deCliente({ minLevel: 'DEBUG' }),
      lote({ eventos: ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].map((nivel) => evento({ nivel, mensaje: nivel })) }),
      AHORA,
    );
    const [ctx, events] = errors.recordOccurrences.mock.calls[0];
    expect(ctx).toEqual({ installationId: 3, aplicativo: 'Facturador', servidor: 'SRV-01', receivedAt: AHORA });
    expect(events.map((e: any) => e.nivel)).toEqual(['ERROR', 'FATAL']);
    expect(events[0]).toMatchObject({ clientId: 7, systemId: 2, logger: 'App.Servicio', mensaje: 'ERROR' });
  });

  it('no llama a recordOccurrences si el lote no trae errores', async () => {
    const { service, errors } = makeService();
    await service.ingest(deCliente(), lote(), AHORA);
    expect(errors.recordOccurrences).not.toHaveBeenCalled();
  });

  it('actualiza el origen (aplicativo, servidor, versión) y last_seen', async () => {
    const { service, installations } = makeService();
    await service.ingest(deCliente(), lote(), AHORA);
    expect(installations.touchSource).toHaveBeenCalledWith(3, 'Facturador', 'SRV-01', '1.0.0', AHORA);
  });

  it('un fallo al actualizar el origen no hace fallar el lote', async () => {
    const { service, installations } = makeService();
    installations.touchSource.mockRejectedValueOnce(new Error('db'));
    await expect(service.ingest(deCliente(), lote(), AHORA)).resolves.toEqual({ aceptados: 1, descartadosPorNivel: 0 });
  });

  it('publica en vivo las líneas aceptadas', async () => {
    const { service, gateway } = makeService();
    await service.ingest(
      deCliente(),
      lote({ eventos: [evento({ nivel: 'DEBUG' }), evento({ nivel: 'WARN', mensaje: 'ojo', hilo: '5' })] }),
      AHORA,
    );
    expect(gateway.publishLogLines).toHaveBeenCalledTimes(1);
    expect(gateway.publishLogLines.mock.calls[0][0]).toEqual([
      {
        ts: HACE_UN_MINUTO,
        nivel: 'WARN',
        instalacionId: 3,
        clienteId: 7,
        sistemaId: 2,
        aplicativo: 'Facturador',
        servidor: 'SRV-01',
        logger: 'App.Servicio',
        mensaje: 'ojo',
        excepcion: null,
        hilo: '5',
      },
    ]);
  });

  it('un cuerpo sin estructura válida → 400 sin tocar nada', async () => {
    const { service, loki } = makeService();
    expect(await statusOf(service.ingest(deCliente(), { eventos: 'x' }, AHORA))).toBe(400);
    expect(loki.push).not.toHaveBeenCalled();
  });

  it('el lote 601 del minuto → 429 con retryAfterSec', async () => {
    const { service, limiter, loki } = makeService();
    for (let i = 0; i < INGEST_MAX_BATCHES_PER_WINDOW; i++) limiter.take(3, AHORA.getTime());
    let err: any;
    try {
      await service.ingest(deCliente(), lote(), AHORA);
    } catch (e) {
      err = e;
    }
    expect(err.getStatus()).toBe(429);
    expect(err.retryAfterSec).toBeGreaterThan(0);
    expect(loki.push).not.toHaveBeenCalled();
  });
});
