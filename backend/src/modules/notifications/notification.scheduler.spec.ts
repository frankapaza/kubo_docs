import { NotificationDispatchError } from './notification-dispatcher.service';
import {
  NOTIFY_ERROR_MAX_LENGTH,
  NOTIFY_MAX_ATTEMPTS,
  NOTIFY_MAX_WRITE_FAILURES,
  NOTIFY_RETRY_DELAYS_MS,
  NotificationScheduler,
  retryDelayMs,
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
const UN_DIA = 24 * 60 * UN_MINUTO;

interface FilaFake {
  id: string;
  ticketId: string;
  type: string;
  createdAt: Date;
  notifiedAt: Date | null;
  notifyAttempts: number;
  notifyNextAttemptAt: Date | null;
  notifyLastError: string | null;
  sentMessageId: string | null;
}

function unaFila(overrides: Partial<FilaFake> = {}): FilaFake {
  return {
    id: '901',
    ticketId: '13',
    type: 'RESOLVED',
    createdAt: T0,
    notifiedAt: null,
    notifyAttempts: 0,
    notifyNextAttemptAt: null,
    notifyLastError: null,
    sentMessageId: null,
    ...overrides,
  };
}

/**
 * Tabla `ticket_events` en memoria que se comporta como la de verdad en las
 * tres cosas que importan aquí:
 *
 * 1. `listPendingNotification` aplica **el mismo filtro que el `WHERE` real**:
 *    `notified_at IS NULL` y, además, `notify_next_attempt_at` nula o vencida.
 *    Sin eso, ni el test de "un evento ya notificado no se vuelve a procesar"
 *    ni los de la espera probarían nada. Que ese `WHERE` sea de verdad el que
 *    emite TypeORM lo comprueba `ticket-events.repository.spec.ts`.
 * 2. Devuelve las filas **ordenadas por id**, como el `ORDER BY`, para poder
 *    comprobar que el vigilante respeta el orden de la cola.
 * 3. **Rechaza un `notify_last_error` de más de 500 caracteres**, como hace
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
    listPendingNotification: jest.fn(async (limit: number, now: Date) =>
      filas
        .filter(
          (f) =>
            f.notifiedAt === null &&
            (f.notifyNextAttemptAt === null || f.notifyNextAttemptAt.getTime() <= now.getTime()),
        )
        .sort((a, b) => Number(a.id) - Number(b.id))
        .slice(0, limit),
    ),
    markNotified: jest.fn(
      async (
        id: unknown,
        notifiedAt: Date,
        attempts: number,
        lastError: string | null,
        sentMessageId: string | null,
      ) => {
        validarError(lastError);
        const fila = buscar(id);
        fila.notifiedAt = notifiedAt;
        fila.notifyAttempts = attempts;
        fila.notifyLastError = lastError;
        fila.notifyNextAttemptAt = null;
        fila.sentMessageId = sentMessageId;
      },
    ),
    recordNotifyFailure: jest.fn(
      async (id: unknown, attempts: number, nextAttemptAt: Date, lastError: string | null) => {
        validarError(lastError);
        const fila = buscar(id);
        fila.notifyAttempts = attempts;
        fila.notifyNextAttemptAt = nextAttemptAt;
        fila.notifyLastError = lastError;
      },
    ),
  };
}

interface RespuestaDespacho {
  sent?: number;
  skipped?: string | null;
  sentMessageId?: string | null;
}

interface OpcionesDespachador {
  /** Por id de evento: qué devuelve o qué lanza el despachador. */
  porEvento?: Record<string, RespuestaDespacho | Error>;
  /** Comportamiento por defecto de los eventos no listados arriba. */
  pordefecto?: RespuestaDespacho | Error;
}

function despachadorFake(opciones: OpcionesDespachador = {}) {
  const { porEvento = {}, pordefecto = { sent: 1, skipped: null } } = opciones;

  return {
    dispatchForEvent: jest.fn(async (event: any) => {
      const respuesta = porEvento[String(event.id)] ?? pordefecto;
      if (respuesta instanceof Error) throw respuesta;
      return {
        sent: respuesta.sent ?? 0,
        skipped: respuesta.skipped ?? null,
        sentMessageId: respuesta.sentMessageId ?? null,
      };
    }),
  };
}

function montar(filas: FilaFake[], opciones: OpcionesDespachador = {}) {
  const repo = tablaFake(filas);
  const dispatcher = despachadorFake(opciones);
  const scheduler = new NotificationScheduler(repo as any, dispatcher as any);
  // Silenciar el logger de Nest: estos tests provocan fallos a propósito y el
  // ruido esconde la salida de jest. Se conservan los espías para poder
  // comprobar que un abandono se grita en vez de pasar en silencio.
  const logs = {
    log: jest.spyOn((scheduler as any).logger, 'log').mockImplementation(() => undefined),
    warn: jest.spyOn((scheduler as any).logger, 'warn').mockImplementation(() => undefined),
    error: jest.spyOn((scheduler as any).logger, 'error').mockImplementation(() => undefined),
  };
  return { scheduler, repo, dispatcher, logs };
}

/** Todo lo que el logger recibió por un canal, junto. */
function textoDe(spy: jest.SpyInstance): string {
  return spy.mock.calls.map((c) => String(c[0])).join('\n');
}

describe('NotificationScheduler', () => {
  describe('la cola drena', () => {
    it('sella el evento que se despachó bien y no lo vuelve a coger', async () => {
      const fila = unaFila();
      const { scheduler, dispatcher } = montar([fila], {
        pordefecto: { sent: 2, skipped: null },
      });

      const primera = await scheduler.drain(T0);

      expect(primera).toEqual({ processed: 1, sent: 2, failed: 0, abandoned: 0 });
      expect(fila.notifiedAt).toEqual(T0);
      expect(fila.notifyLastError).toBeNull();

      const segunda = await scheduler.drain(enT0Mas(60 * UN_MINUTO));

      expect(segunda).toEqual({ processed: 0, sent: 0, failed: 0, abandoned: 0 });
      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(1);
    });

    /**
     * El trabajo que el vigilante tenía olvidado: `EmailService.send` ya le
     * daba el `Message-ID` al despachador, y el despachador se lo devuelve en
     * `DispatchResult.sentMessageId`, pero nadie lo llevaba hasta
     * `ticket_events.sent_message_id`. Sin esto, la correlación de una
     * respuesta a un aviso posterior -- no al acuse inicial -- está muerta.
     */
    it('sella con el Message-ID del aviso al cliente que le dio el despachador', async () => {
      const fila = unaFila();
      const { scheduler } = montar([fila], {
        pordefecto: { sent: 1, skipped: null, sentMessageId: '<aviso-2@kuboti.com>' },
      });

      await scheduler.drain(T0);

      expect(fila.sentMessageId).toBe('<aviso-2@kuboti.com>');
    });

    it('un aviso que solo fue al equipo sella sin Message-ID de cliente', async () => {
      const fila = unaFila();
      const { scheduler } = montar([fila], {
        pordefecto: { sent: 1, skipped: null, sentMessageId: null },
      });

      await scheduler.drain(T0);

      expect(fila.sentMessageId).toBeNull();
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

      expect(resumen).toEqual({ processed: 1, sent: 0, failed: 0, abandoned: 0 });
      expect(fila.notifiedAt).toEqual(T0);
      // La razón queda escrita para poder mirarla, no se tira.
      expect(fila.notifyLastError).toBe('El evento no genera ningún aviso.');
    });

    /**
     * El orden de la cola es el del `id`, y el vigilante lo respeta: sin eso,
     * un lote grande podría despachar el acuse de un ticket después de su
     * cierre. Que el `ORDER BY` esté de verdad en la consulta lo comprueba
     * `ticket-events.repository.spec.ts`; aquí se comprueba que el vigilante
     * consume lo que le llega en ese mismo orden.
     */
    it('despacha en el orden de la cola y acota el lote', async () => {
      const filas = ['903', '901', '902'].map((id) => unaFila({ id }));
      const { scheduler, repo, dispatcher } = montar(filas);

      await scheduler.drain(T0);

      const despachados = dispatcher.dispatchForEvent.mock.calls.map((c) => c[0].id);
      expect(despachados).toEqual(['901', '902', '903']);

      const [limite, now] = repo.listPendingNotification.mock.calls[0];
      expect(limite).toBeGreaterThan(0);
      // `now` viaja hasta la consulta: es lo que permite que el filtro de la
      // espera viva en el `WHERE` y siga siendo probable.
      expect(now).toEqual(T0);
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

      expect(resumen).toEqual({ processed: 1, sent: 0, failed: 1, abandoned: 0 });
      expect(fila.notifiedAt).toBeNull();
      expect(fila.notifyAttempts).toBe(1);
      expect(fila.notifyLastError).toContain('No se pudieron enviar 1 de 1 avisos');
    });

    /**
     * `sent` cuenta **correos**, no eventos con éxito, y el envío parcial es
     * el único caso en que ese matiz importa: un evento que manda dos avisos,
     * sale el primero y falla el segundo. El despachador se molesta en
     * contarlo en `sentEntries` justo para esto; si el vigilante no lo lee, el
     * resumen dice que no salió ningún correo el mismo minuto en que un
     * cliente recibió el suyo, y el día que pregunte por qué le llegó dos
     * veces no hay nada en el log que lo explique.
     */
    it('en un envío parcial cuenta los correos que sí salieron', async () => {
      const fila = unaFila();
      const { scheduler } = montar([fila], {
        pordefecto: new NotificationDispatchError(
          'No se pudieron enviar 1 de 2 avisos del evento 901 (ticket 13). ' +
            'Fallaron: TICKET_CREATED_PORTAL/TEAM: ECONNREFUSED. Ya habían salido 1 de 2 ' +
            '(TICKET_CREATED/CLIENT); el reintento del evento los repetirá.',
          ['TICKET_CREATED/CLIENT'],
          ['TICKET_CREATED_PORTAL/TEAM'],
          [new Error('ECONNREFUSED')],
        ),
      });

      const resumen = await scheduler.drain(T0);

      expect(resumen).toEqual({ processed: 1, sent: 1, failed: 1, abandoned: 0 });
    });

    /** Un fallo que no viene del despachador no aporta ningún correo enviado. */
    it('un error cualquiera no inventa correos enviados', async () => {
      const { scheduler } = montar([unaFila()], { pordefecto: new Error('la base no responde') });

      const resumen = await scheduler.drain(T0);

      expect(resumen.sent).toBe(0);
    });

    it('el evento que acaba de fallar no se reintenta en la pasada siguiente', async () => {
      const fila = unaFila();
      const { scheduler, dispatcher } = montar([fila], {
        pordefecto: new Error('SMTP caído'),
      });

      await scheduler.drain(T0);
      expect(fila.notifyAttempts).toBe(1);

      // La pasada siguiente del cron, un minuto después.
      const siguiente = await scheduler.drain(enT0Mas(UN_MINUTO));

      expect(siguiente).toEqual({ processed: 0, sent: 0, failed: 0, abandoned: 0 });
      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(1);
      expect(fila.notifyAttempts).toBe(1);
    });

    it('lo reintenta cuando la espera del intento ya transcurrió', async () => {
      const fila = unaFila();
      const { scheduler, dispatcher } = montar([fila], {
        pordefecto: new Error('SMTP caído'),
      });

      await scheduler.drain(T0);
      // Ya no falla: el segundo intento sale.
      dispatcher.dispatchForEvent.mockImplementation(async () => ({ sent: 1, skipped: null, sentMessageId: null }));

      await scheduler.drain(enT0Mas(retryDelayMs(1) + 1_000));

      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(2);
      expect(fila.notifiedAt).not.toBeNull();
    });

    /**
     * El agujero que tenía la versión anterior, y la razón de la migración 016.
     *
     * Midiendo la espera desde `created_at` con retrasos acumulados, un evento
     * más viejo que el retraso mayor cumplía TODOS los retrasos a la vez:
     * gastaba sus tres intentos en tres pasadas seguidas —tres minutos— y
     * quedaba abandonado. Y pasaba justo cuando el SMTP volvía de una caída
     * larga, que es cuando los reintentos tienen que servir para algo.
     */
    it('un evento viejo no quema sus tres intentos en pasadas consecutivas', async () => {
      // Nació hace tres días y nadie lo ha mirado: más viejo que cualquier
      // retraso del esquema.
      const fila = unaFila({ createdAt: new Date(T0.getTime() - 3 * UN_DIA) });
      const { scheduler, dispatcher } = montar([fila], {
        pordefecto: new Error('SMTP caído'),
      });

      // Primera pasada: le toca (nunca se intentó) y falla.
      await scheduler.drain(T0);
      expect(fila.notifyAttempts).toBe(1);
      expect(fila.notifiedAt).toBeNull();

      // Las tres pasadas siguientes del cron, minuto a minuto. Con el fallo
      // antiguo, aquí habría gastado los intentos 2 y 3 y quedado abandonado.
      for (const minuto of [1, 2, 3]) {
        await scheduler.drain(enT0Mas(minuto * UN_MINUTO));
      }

      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(1);
      expect(fila.notifyAttempts).toBe(1);
      expect(fila.notifiedAt).toBeNull();
    });

    /**
     * "Creciente" comprobado por comportamiento, no aseverando sobre la
     * constante: se mira el instante que queda **guardado en la fila** tras
     * cada fallo. Un `isDue` que devolviera siempre `true` no pasaría esto.
     */
    it('la espera guardada crece con cada intento', async () => {
      const fila = unaFila();
      const { scheduler } = montar([fila], { pordefecto: new Error('SMTP caído') });

      await scheduler.drain(T0);
      const primeraEspera = fila.notifyNextAttemptAt!.getTime() - T0.getTime();

      const segundoIntento = enT0Mas(retryDelayMs(1) + 1_000);
      await scheduler.drain(segundoIntento);
      const segundaEspera = fila.notifyNextAttemptAt!.getTime() - segundoIntento.getTime();

      expect(fila.notifyAttempts).toBe(2);
      expect(primeraEspera).toBeGreaterThan(0);
      expect(segundaEspera).toBeGreaterThan(primeraEspera);
      // Y coinciden con la tabla declarada, que es la que documenta el reparto.
      expect(primeraEspera).toBe(NOTIFY_RETRY_DELAYS_MS[0]);
      expect(segundaEspera).toBe(NOTIFY_RETRY_DELAYS_MS[1]);
    });

    it('el fallo que agota el tope sella la fila, la cuenta como abandonada y lo grita', async () => {
      const fila = unaFila({ notifyAttempts: NOTIFY_MAX_ATTEMPTS - 1 });
      const { scheduler, logs } = montar([fila], { pordefecto: new Error('SMTP caído') });

      const resumen = await scheduler.drain(enT0Mas(UN_DIA));

      expect(resumen).toEqual({ processed: 1, sent: 0, failed: 1, abandoned: 1 });
      expect(fila.notifiedAt).not.toBeNull();
      expect(fila.notifyAttempts).toBe(NOTIFY_MAX_ATTEMPTS);
      expect(fila.notifyLastError).toContain('SMTP caído');
      // Un aviso perdido no puede quedarse en un `log` entre el ruido.
      expect(textoDe(logs.error)).toMatch(/abandona/i);
    });

    /**
     * El caso que se perdía antes de esta ronda: el último intento entregó de
     * verdad el aviso al cliente (el del equipo fue el que rebotó), y aun así
     * se abandona por agotar el tope. Sellar sin su `Message-ID` habría
     * dejado sin correlacionar una respuesta a un correo que sí llegó.
     */
    it('un abandono con envío parcial guarda igual el Message-ID que sí salió al cliente', async () => {
      const fila = unaFila({ notifyAttempts: NOTIFY_MAX_ATTEMPTS - 1 });
      const { scheduler } = montar([fila], {
        pordefecto: new NotificationDispatchError(
          'No se pudieron enviar 1 de 2 avisos del evento 901 (ticket 13).',
          ['TICKET_CREATED/CLIENT'],
          ['TICKET_CREATED_PORTAL/TEAM'],
          [new Error('ECONNREFUSED')],
          '<parcial-cliente@kuboti.com>',
        ),
      });

      const resumen = await scheduler.drain(enT0Mas(UN_DIA));

      expect(resumen.abandoned).toBe(1);
      expect(fila.sentMessageId).toBe('<parcial-cliente@kuboti.com>');
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

      const resumen = await scheduler.drain(enT0Mas(UN_DIA));

      expect(dispatcher.dispatchForEvent).not.toHaveBeenCalled();
      expect(resumen).toEqual({ processed: 1, sent: 0, failed: 0, abandoned: 1 });
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
      expect(resumen).toEqual({ processed: 3, sent: 2, failed: 1, abandoned: 0 });
      expect(primero.notifiedAt).toEqual(T0);
      expect(tercero.notifiedAt).toEqual(T0);
      expect(segundo.notifiedAt).toBeNull();
      expect(segundo.notifyAttempts).toBe(1);
    });
  });

  describe('fallos al escribir el resultado', () => {
    /**
     * Un fallo al **escribir** tampoco puede tumbar el lote: si la base rechaza
     * un `UPDATE`, los eventos siguientes tienen que salir igual.
     */
    it('no detienen el lote', async () => {
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

    /** Los correos salieron: que el `UPDATE` fallara después no los retira. */
    it('cuentan igual los correos que ya salieron', async () => {
      const fila = unaFila();
      const { scheduler, repo } = montar([fila], { pordefecto: { sent: 2 } });
      repo.markNotified.mockRejectedValueOnce(new Error('ER_LOCK_WAIT_TIMEOUT'));

      const resumen = await scheduler.drain(T0);

      // No se pudo anotar (`processed` 0), pero dos correos están entregados.
      expect(resumen).toEqual({ processed: 0, sent: 2, failed: 0, abandoned: 0 });
    });

    /**
     * El agujero que el tope de intentos no cubre. Si el despacho sale bien
     * pero el sellado falla, la fila sigue pendiente **y `notify_attempts` no
     * avanza**: la pasada siguiente reenvía los mismos correos, vuelve a
     * fallar, y así cada sesenta segundos para siempre.
     */
    it('tras varios fallos seguidos deja de despachar el evento, y lo dice a gritos', async () => {
      const fila = unaFila();
      const { scheduler, repo, dispatcher, logs } = montar([fila], { pordefecto: { sent: 1 } });
      repo.markNotified.mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT'));

      // Tantas pasadas como fallos de escritura se toleran, más tres de más.
      for (let i = 0; i < NOTIFY_MAX_WRITE_FAILURES + 3; i += 1) {
        await scheduler.drain(enT0Mas(i * UN_MINUTO));
      }

      // Se despachó exactamente mientras se le toleraron fallos, y ni una vez
      // más: sin el freno serían seis reenvíos y seguiría cada minuto.
      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(NOTIFY_MAX_WRITE_FAILURES);
      expect(fila.notifyAttempts).toBe(0);
      expect(textoDe(logs.error)).toMatch(/BLOQUEADO/);
    });

    it('el mismo freno vale cuando lo que falla es registrar el fallo', async () => {
      const fila = unaFila();
      const { scheduler, repo, dispatcher } = montar([fila], {
        pordefecto: new Error('SMTP caído'),
      });
      repo.recordNotifyFailure.mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT'));

      for (let i = 0; i < NOTIFY_MAX_WRITE_FAILURES + 3; i += 1) {
        await scheduler.drain(enT0Mas(i * UN_MINUTO));
      }

      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(NOTIFY_MAX_WRITE_FAILURES);
    });

    it('una escritura que sale bien borra los fallos acumulados del evento', async () => {
      const fila = unaFila();
      const { scheduler, repo, dispatcher } = montar([fila], { pordefecto: { sent: 1 } });

      // Falla una vez menos de la cuenta, y luego se recupera.
      for (let i = 0; i < NOTIFY_MAX_WRITE_FAILURES - 1; i += 1) {
        repo.markNotified.mockRejectedValueOnce(new Error('ER_LOCK_WAIT_TIMEOUT'));
        await scheduler.drain(enT0Mas(i * UN_MINUTO));
      }
      await scheduler.drain(enT0Mas(10 * UN_MINUTO));

      expect(fila.notifiedAt).not.toBeNull();
      // Nunca llegó a bloquearse: el contador se limpió con la escritura buena.
      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(NOTIFY_MAX_WRITE_FAILURES);
      expect((scheduler as any).blocked.size).toBe(0);
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

    /**
     * El texto del abandono se compone envolviendo el último error. Si una
     * fila vuelve a mirarse con el prefijo ya dentro, envolverlo otra vez
     * anidaría el prefijo hasta empujar el error original fuera de los 500
     * caracteres — y el motivo de un aviso perdido es lo último que puede
     * desaparecer por un problema de formato.
     *
     * La versión anterior de este test montaba el escenario con
     * `markNotified.mockRejectedValueOnce`, y no probaba nada: eso **sustituye
     * la implementación del doble**, así que la primera pasada no escribía el
     * texto envuelto en ninguna parte y la segunda releía el error pelado. La
     * guarda nunca llegaba a ejercitarse y el test pasaba igual sin ella.
     *
     * Y no es que el escenario estuviera mal montado: es que ese escenario no
     * existe. Un `UPDATE` que falla no escribe nada, así que un sellado
     * fallido no puede dejar el prefijo en la fila. El camino real es el otro:
     * alguien devuelve a la cola un evento ya abandonado —justo lo que invita
     * a hacer el log, "si el aviso importaba, hay que rehacerlo a mano"— y la
     * fila reaparece con el texto envuelto que le grabó el abandono anterior.
     */
    it('el texto del abandono no se anida cuando la fila vuelve a la cola', async () => {
      const fila = unaFila({
        notifyAttempts: NOTIFY_MAX_ATTEMPTS,
        notifyLastError: '550 el buzón del cliente no existe',
      });
      const { scheduler } = montar([fila]);

      // Primera pasada: se abandona y queda sellada con el texto envuelto.
      // Se toma de aquí, no de una constante copiada, para que el test no
      // dependa de cómo esté redactado el prefijo.
      await scheduler.drain(T0);
      const envuelto = fila.notifyLastError!;
      expect(envuelto).toMatch(/^Agotados los/);

      // Alguien la devuelve a la cola a mano para reintentar el aviso.
      fila.notifiedAt = null;
      await scheduler.drain(enT0Mas(UN_MINUTO));

      expect(fila.notifiedAt).not.toBeNull();
      // El texto es exactamente el mismo: ni una capa más.
      expect(fila.notifyLastError).toBe(envuelto);
      expect(fila.notifyLastError!.match(/Agotados los/g)).toHaveLength(1);
      expect(fila.notifyLastError).toContain('550 el buzón del cliente no existe');
    });
  });

  /**
   * `@nestjs/schedule` **no espera** a que termine el callback anterior:
   * `waitForCompletion` vale `false` por omisión. Y una pasada pasa de sesenta
   * segundos con facilidad —lote de cien, envíos secuenciales, un transporter
   * nuevo por correo—, así que la segunda entra mientras la primera aún no ha
   * sellado ninguna fila: la consulta le devuelve exactamente las mismas y las
   * despacha otra vez. No es el duplicado ya aceptado (el del reintento, que
   * viene con un fallo registrado, o el de dos réplicas): aquí duplica el
   * camino feliz con una sola instancia.
   */
  describe('dos pasadas solapadas', () => {
    /** Un despacho que se queda colgado, como un SMTP que no responde. */
    function despachoColgado(dispatcher: ReturnType<typeof despachadorFake>) {
      let liberar!: () => void;
      const colgado = new Promise<void>((resolve) => {
        liberar = resolve;
      });
      dispatcher.dispatchForEvent.mockImplementation(async () => {
        await colgado;
        return { sent: 1, skipped: null, sentMessageId: null };
      });
      return liberar;
    }

    it('la segunda no vuelve a despachar la fila que la primera tiene en vuelo', async () => {
      const fila = unaFila();
      const { scheduler, dispatcher, logs } = montar([fila]);
      const liberar = despachoColgado(dispatcher);

      // La pasada del minuto uno se queda dentro del envío...
      const primera = scheduler.handleCron();
      // ...y entra la del minuto dos, con la fila todavía sin sellar.
      await scheduler.handleCron();

      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(1);
      // Y se entera quien lea el log: una pasada saltada no puede confundirse
      // con un minuto sin trabajo.
      expect(textoDe(logs.warn)).toMatch(/en curso/i);

      liberar();
      await primera;

      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(1);
      expect(fila.notifiedAt).not.toBeNull();
    });

    it('la pasada siguiente drena con normalidad en cuanto la anterior termina', async () => {
      const primeraFila = unaFila({ id: '901' });
      const { scheduler, dispatcher, repo } = montar([primeraFila]);
      const liberar = despachoColgado(dispatcher);

      const primera = scheduler.handleCron();
      await scheduler.handleCron();
      liberar();
      await primera;

      // Llega una fila nueva y el cron siguiente la coge: el freno solo dura
      // lo que dura la pasada.
      repo.filas.push(unaFila({ id: '902' }));
      dispatcher.dispatchForEvent.mockImplementation(async () => ({ sent: 1, skipped: null, sentMessageId: null }));
      await scheduler.handleCron();

      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(2);
      expect(repo.filas[1].notifiedAt).not.toBeNull();
    });

    it('una pasada que revienta no deja el freno echado', async () => {
      const fila = unaFila();
      const { scheduler, dispatcher } = montar([fila]);
      jest.spyOn(scheduler, 'drain').mockRejectedValueOnce(new Error('la base no responde'));

      await scheduler.handleCron();
      // El spy solo falla una vez: la pasada siguiente usa el `drain` real.
      await scheduler.handleCron();

      expect(dispatcher.dispatchForEvent).toHaveBeenCalledTimes(1);
      expect(fila.notifiedAt).not.toBeNull();
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

    it('registra el abandono como error, no como una línea más del log', async () => {
      const fila = unaFila({ notifyAttempts: NOTIFY_MAX_ATTEMPTS, notifyLastError: '550' });
      const { scheduler, logs } = montar([fila]);

      await scheduler.handleCron();

      expect(textoDe(logs.error)).toMatch(/1 abandonado/);
      expect(textoDe(logs.log)).not.toMatch(/abandonado/);
    });
  });
});
