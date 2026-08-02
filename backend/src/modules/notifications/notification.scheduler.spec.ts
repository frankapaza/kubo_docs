import { NotificationDispatchError } from './notification-dispatcher.service';
import {
  NOTIFY_ERROR_MAX_LENGTH,
  NOTIFY_MAX_ATTEMPTS,
  NOTIFY_RETRY_DELAYS_MS,
  NotificationScheduler,
} from './notification.scheduler';

/**
 * Los `id` van como **cadena** en todos los dobles, igual que en la spec del
 * despachador: es como TypeORM hidrata las columnas `bigint` por mucho que la
 * entidad las declare `number`. Si el vigilante busca la fila con `===`
 * estricto contra un número, estos tests lo cazan.
 */
const T0 = new Date('2026-08-02T12:00:00Z');

/** Un instante desplazado de `T0`, en milisegundos. */
function enT0Mas(ms: number): Date {
  return new Date(T0.getTime() + ms);
}

const UN_MINUTO = 60_000;

interface FilaFake {
  id: string;
  ticketId: string;
  type: string;
  createdAt: Date;
  notifiedAt: Date | null;
  notifyAttempts: number;
  notifyLastError: string | null;
}

function unaFila(overrides: Partial<FilaFake> = {}): FilaFake {
  return {
    id: '901',
    ticketId: '13',
    type: 'RESOLVED',
    createdAt: T0,
    notifiedAt: null,
    notifyAttempts: 0,
    notifyLastError: null,
    ...overrides,
  };
}

/**
 * Tabla `ticket_events` en memoria que se comporta como la de verdad en las
 * dos cosas que importan aquí:
 *
 * 1. `listPendingNotification` filtra ella misma por `notified_at IS NULL`. Sin
 *    eso, el test de "un evento ya notificado no se vuelve a procesar" no
 *    probaría nada: pasaría igual con un vigilante que ignore el sellado.
 * 2. **Rechaza un `notify_last_error` de más de 500 caracteres**, como hace
 *    MySQL en `STRICT_TRANS_TABLES` con `ER_DATA_TOO_LONG`. Es el fallo que
 *    deja la fila reintentando para siempre y sin rastro del motivo, así que
 *    el doble tiene que poder reproducirlo.
 */
function tablaFake(filas: FilaFake[]) {
  const buscar = (id: unknown): FilaFake => {
    // Comparación por cadena a propósito: el id llega tal cual lo hidrató
    // TypeORM y el doble no debe ser más permisivo que la base.
    const fila = filas.find((f) => String(f.id) === String(id));
    if (!fila) throw new Error(`La fila ${String(id)} no existe en la tabla fake.`);
    return fila;
  };

  const validarError = (texto: string | null): void => {
    if (texto !== null && texto.length > NOTIFY_ERROR_MAX_LENGTH) {
      throw new Error(
        `ER_DATA_TOO_LONG: Data too long for column 'notify_last_error' (${texto.length} caracteres).`,
      );
    }
  };

  return {
    filas,
    listPendingNotification: jest.fn(async (limit: number) =>
      filas
        .filter((f) => f.notifiedAt === null)
        .sort((a, b) => Number(a.id) - Number(b.id))
        .slice(0, limit),
    ),
    markNotified: jest.fn(
      async (id: unknown, notifiedAt: Date, attempts: number, lastError: string | null) => {
        validarError(lastError);
        const fila = buscar(id);
        fila.notifiedAt = notifiedAt;
        fila.notifyAttempts = attempts;
        fila.notifyLastError = lastError;
      },
    ),
    recordNotifyFailure: jest.fn(
      async (id: unknown, attempts: number, lastError: string | null) => {
        validarError(lastError);
        const fila = buscar(id);
        fila.notifyAttempts = attempts;
        fila.notifyLastError = lastError;
      },
    ),
  };
}

interface OpcionesDespachador {
  /** Por id de evento: qué devuelve o qué lanza el despachador. */
  porEvento?: Record<string, { sent?: number; skipped?: string | null } | Error>;
  /** Comportamiento por defecto de los eventos no listados arriba. */
  pordefecto?: { sent?: number; skipped?: string | null } | Error;
}

function despachadorFake(opciones: OpcionesDespachador = {}) {
  const { porEvento = {}, pordefecto = { sent: 1, skipped: null } } = opciones;

  return {
    dispatchForEvent: jest.fn(async (event: any) => {
      const respuesta = porEvento[String(event.id)] ?? pordefecto;
      if (respuesta instanceof Error) throw respuesta;
      return { sent: respuesta.sent ?? 0, skipped: respuesta.skipped ?? null };
    }),
  };
}

function montar(filas: FilaFake[], opciones: OpcionesDespachador = {}) {
  const repo = tablaFake(filas);
  const dispatcher = despachadorFake(opciones);
  const scheduler = new NotificationScheduler(repo as any, dispatcher as any);
  // Silenciar el logger de Nest: estos tests provocan fallos a propósito y el
  // ruido esconde la salida de jest.
  jest.spyOn((scheduler as any).logger, 'log').mockImplementation(() => undefined);
  jest.spyOn((scheduler as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((scheduler as any).logger, 'error').mockImplementation(() => undefined);
  return { scheduler, repo, dispatcher };
}

describe('NotificationScheduler', () => {
  describe('la cola drena', () => {
    it('sella el evento que se despachó bien y no lo vuelve a coger', async () => {
      const fila = unaFila();
      const { scheduler, dispatcher } = montar([fila], {
        pordefecto: { sent: 2, skipped: null },
      });

      const primera = await scheduler.drain(T0);

      expect(primera).toEqual({ processed: 1, sent: 2, failed: 0 });
      expect(fila.notifiedAt).toEqual(T0);
      expect(fila.notifyLastError).toBeNull();

      const segunda = await scheduler.drain(enT0Mas(60 * UN_MINUTO));

      expect(segunda).toEqual({ processed: 0, sent: 0, failed: 0 });
      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(1);
    });

    it('un evento ya notificado no se vuelve a procesar', async () => {
      const sellado = unaFila({ id: '900', notifiedAt: new Date('2026-08-01T09:00:00Z') });
      const pendiente = unaFila({ id: '901' });
      const { scheduler, dispatcher } = montar([sellado, pendiente]);

      await scheduler.drain(T0);

      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(1);
      expect(dispatcher.dispatchForEvent.mock.calls[0][0].id).toBe('901');
      // El sellado conserva su marca original: no se repisa con `now`.
      expect(sellado.notifiedAt).toEqual(new Date('2026-08-01T09:00:00Z'));
    });

    /**
     * El caso normal, no el raro: la mayoría de los tipos de evento no avisan a
     * nadie. Si no se sellaran, la cola crecería sin fin y cada pasada
     * rearrastraría las mismas filas para no hacer nada con ellas.
     */
    it('sella igualmente el evento que no genera ningún aviso, y no manda nada', async () => {
      const fila = unaFila({ type: 'ASSIGNED' });
      const { scheduler } = montar([fila], {
        pordefecto: { sent: 0, skipped: 'El evento no genera ningún aviso.' },
      });

      const resumen = await scheduler.drain(T0);

      expect(resumen).toEqual({ processed: 1, sent: 0, failed: 0 });
      expect(fila.notifiedAt).toEqual(T0);
      // La razón queda escrita para poder mirarla, no se tira.
      expect(fila.notifyLastError).toBe('El evento no genera ningún aviso.');
    });

    it('pide el lote acotado y ordenado por id', async () => {
      const { scheduler, repo } = montar([unaFila()]);

      await scheduler.drain(T0);

      expect(repo.listPendingNotification).toHaveBeenCalledTimes(1);
      const limite = repo.listPendingNotification.mock.calls[0][0];
      expect(typeof limite).toBe('number');
      expect(limite).toBeGreaterThan(0);
    });
  });

  describe('fallos y reintentos', () => {
    it('un fallo incrementa los intentos, guarda el error y NO sella', async () => {
      const fila = unaFila();
      const { scheduler } = montar([fila], {
        pordefecto: new NotificationDispatchError(
          'No se pudieron enviar 1 de 1 avisos del evento 901 (ticket 13).',
          [],
          ['TICKET_RESOLVED/CLIENT'],
          [new Error('ECONNREFUSED')],
        ),
      });

      const resumen = await scheduler.drain(T0);

      expect(resumen).toEqual({ processed: 1, sent: 0, failed: 1 });
      expect(fila.notifiedAt).toBeNull();
      expect(fila.notifyAttempts).toBe(1);
      expect(fila.notifyLastError).toContain('No se pudieron enviar 1 de 1 avisos');
    });

    /**
     * La espera creciente sin columna nueva: el instante de referencia es
     * `created_at`, y el retraso exigido crece con `notify_attempts`.
     */
    it('el evento que acaba de fallar no se reintenta en la pasada siguiente', async () => {
      const fila = unaFila();
      const { scheduler, dispatcher } = montar([fila], {
        pordefecto: new Error('SMTP caído'),
      });

      await scheduler.drain(T0);
      expect(fila.notifyAttempts).toBe(1);

      // La pasada siguiente del cron, un minuto después.
      const siguiente = await scheduler.drain(enT0Mas(UN_MINUTO));

      expect(siguiente).toEqual({ processed: 0, sent: 0, failed: 0 });
      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(1);
      expect(fila.notifyAttempts).toBe(1);
    });

    it('lo reintenta cuando la espera del intento ya transcurrió', async () => {
      const fila = unaFila({ notifyAttempts: 1 });
      const { scheduler, dispatcher } = montar([fila], { pordefecto: { sent: 1 } });

      await scheduler.drain(enT0Mas(NOTIFY_RETRY_DELAYS_MS[1] + 1_000));

      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(1);
      expect(fila.notifiedAt).not.toBeNull();
    });

    it('la espera crece con cada intento', async () => {
      // Sin duplicados y estrictamente creciente: si no lo fuera, "espera
      // creciente" sería solo una palabra en el comentario.
      for (let i = 1; i < NOTIFY_RETRY_DELAYS_MS.length; i += 1) {
        expect(NOTIFY_RETRY_DELAYS_MS[i]).toBeGreaterThan(NOTIFY_RETRY_DELAYS_MS[i - 1]);
      }
      expect(NOTIFY_RETRY_DELAYS_MS[0]).toBe(0);
    });

    it('el fallo que agota el tope sella la fila y deja el error grabado', async () => {
      const fila = unaFila({ notifyAttempts: NOTIFY_MAX_ATTEMPTS - 1 });
      const { scheduler } = montar([fila], { pordefecto: new Error('SMTP caído') });

      const resumen = await scheduler.drain(enT0Mas(24 * 60 * UN_MINUTO));

      expect(resumen).toEqual({ processed: 1, sent: 0, failed: 1 });
      expect(fila.notifiedAt).not.toBeNull();
      expect(fila.notifyAttempts).toBe(NOTIFY_MAX_ATTEMPTS);
      expect(fila.notifyLastError).toContain('SMTP caído');
    });

    /**
     * Una fila que llega con el tope ya agotado (por ejemplo, la dejó una caída
     * a medio camino) no puede quedarse pendiente: se sella sin volver a
     * intentarla, o se queda en la cabeza del índice para siempre.
     */
    it('el evento que ya agotó los intentos se sella sin volver a despacharlo', async () => {
      const fila = unaFila({
        notifyAttempts: NOTIFY_MAX_ATTEMPTS,
        notifyLastError: 'ECONNREFUSED contra smtp.kuboti.com',
      });
      const { scheduler, dispatcher } = montar([fila]);

      const resumen = await scheduler.drain(enT0Mas(24 * 60 * UN_MINUTO));

      expect(dispatcher.dispatchForEvent).not.toHaveBeenCalled();
      expect(resumen).toEqual({ processed: 1, sent: 0, failed: 0 });
      expect(fila.notifiedAt).not.toBeNull();
      expect(fila.notifyLastError).toContain('ECONNREFUSED contra smtp.kuboti.com');
    });

    it('un fallo no detiene el lote: los demás eventos se procesan igual', async () => {
      const primero = unaFila({ id: '901' });
      const segundo = unaFila({ id: '902' });
      const tercero = unaFila({ id: '903' });
      const { scheduler, dispatcher } = montar([primero, segundo, tercero], {
        porEvento: { '902': new Error('rebotó la dirección') },
        pordefecto: { sent: 1 },
      });

      const resumen = await scheduler.drain(T0);

      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(3);
      expect(resumen).toEqual({ processed: 3, sent: 2, failed: 1 });
      expect(primero.notifiedAt).toEqual(T0);
      expect(tercero.notifiedAt).toEqual(T0);
      expect(segundo.notifiedAt).toBeNull();
      expect(segundo.notifyAttempts).toBe(1);
    });

    /**
     * Un fallo al **escribir** el resultado tampoco puede tumbar el lote: si la
     * base rechaza un `UPDATE`, los eventos siguientes tienen que salir igual.
     */
    it('un fallo al registrar el resultado no detiene el lote', async () => {
      const primero = unaFila({ id: '901' });
      const segundo = unaFila({ id: '902' });
      const { scheduler, repo, dispatcher } = montar([primero, segundo], {
        pordefecto: { sent: 1 },
      });
      repo.markNotified.mockRejectedValueOnce(new Error('ER_LOCK_WAIT_TIMEOUT'));

      await expect(scheduler.drain(T0)).resolves.toBeDefined();

      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(2);
      expect(segundo.notifiedAt).toEqual(T0);
    });
  });

  describe('el error se trunca antes de guardarlo', () => {
    /**
     * `notify_last_error` es `VARCHAR(500)` y MySQL está en
     * `STRICT_TRANS_TABLES`: sin recortar, el propio `UPDATE` que registra el
     * fallo revienta con `ER_DATA_TOO_LONG` y la fila se queda reintentando sin
     * dejar rastro de por qué. La tabla fake lanza igual que MySQL.
     */
    it('recorta un error larguísimo por debajo del ancho de la columna', async () => {
      const fila = unaFila();
      const enorme = new Error(`550 rechazado: ${'x'.repeat(4_000)}`);
      const { scheduler } = montar([fila], { pordefecto: enorme });

      await scheduler.drain(T0);

      expect(fila.notifyLastError).not.toBeNull();
      expect(fila.notifyLastError!.length).toBeLessThanOrEqual(NOTIFY_ERROR_MAX_LENGTH);
      // Lo que se conserva es el principio, que es donde está el motivo.
      expect(fila.notifyLastError).toContain('550 rechazado');
      expect(fila.notifyAttempts).toBe(1);
      expect(fila.notifiedAt).toBeNull();
    });

    it('aplana las respuestas multilínea del servidor en una sola línea', async () => {
      const fila = unaFila();
      const { scheduler } = montar([fila], {
        pordefecto: new Error('550 rechazado\r\n  el buzón no existe\n  contacte al postmaster'),
      });

      await scheduler.drain(T0);

      expect(fila.notifyLastError).not.toMatch(/[\r\n]/);
      expect(fila.notifyLastError).toContain('el buzón no existe');
    });

    it('recorta también la razón del sellado, no solo los errores', async () => {
      const fila = unaFila();
      const { scheduler } = montar([fila], {
        pordefecto: { sent: 0, skipped: 'z'.repeat(2_000) },
      });

      await scheduler.drain(T0);

      expect(fila.notifiedAt).toEqual(T0);
      expect(fila.notifyLastError!.length).toBeLessThanOrEqual(NOTIFY_ERROR_MAX_LENGTH);
    });

    it('nunca guarda la pila de la excepción', async () => {
      const fila = unaFila();
      const error = new Error('SMTP caído');
      error.stack = 'Error: SMTP caído\n    at Object.<anonymous> (/app/src/secreto.ts:12:9)';
      const { scheduler } = montar([fila], { pordefecto: error });

      await scheduler.drain(T0);

      expect(fila.notifyLastError).not.toContain('secreto.ts');
      expect(fila.notifyLastError).toContain('SMTP caído');
    });
  });

  describe('el cron', () => {
    it('llama a drain', async () => {
      const { scheduler } = montar([unaFila()]);
      const drain = jest.spyOn(scheduler, 'drain');

      await scheduler.handleCron();

      expect(drain).toHaveBeenCalledTimes(1);
      expect(drain.mock.calls[0][0]).toBeInstanceOf(Date);
    });

    it('no deja escapar un fallo del drenaje: el cron siguiente tiene que correr', async () => {
      const { scheduler } = montar([unaFila()]);
      jest.spyOn(scheduler, 'drain').mockRejectedValue(new Error('la base no responde'));

      await expect(scheduler.handleCron()).resolves.toBeUndefined();
    });
  });
});
