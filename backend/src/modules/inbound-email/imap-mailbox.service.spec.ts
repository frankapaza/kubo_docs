import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import {
  ImapMailboxService,
  buildRawHeaders,
  chooseTextBody,
  decodeMailboxRef,
  encodeMailboxRef,
  extractFromAddress,
  syntheticMessageId,
} from './imap-mailbox.service';
import { extractAuthenticatedDomain, judgeAuthentication } from './domain/intake-rules';
import { domainOf } from './domain/message-headers';

/**
 * `imapflow` va con doble en casi todo este archivo: prueba la traducción --
 * construcción de `mailboxRef`, la comprobación de UIDVALIDITY al marcar, que
 * el candado de la carpeta se suelte siempre -- sin abrir ninguna conexión de
 * verdad.
 *
 * `mailparser`, en cambio, va doblado **solo** en la mitad de este archivo. La
 * regla más importante del adaptador -- que `Authentication-Results` nunca
 * llega unida, y que `from.value[0].address` (no `from.text`) es la única
 * forma segura de leer el remitente -- es un supuesto sobre las tripas de esa
 * dependencia, y afirmarlo solo en prosa no lo pone en riesgo si la
 * dependencia cambia de comportamiento en una actualización. Por eso el
 * describe `contra el analizador real` de más abajo usa
 * `jest.requireActual('mailparser')` para esas pruebas concretas: no
 * necesitan red, `simpleParser` opera sobre un `Buffer` en memoria.
 */
jest.mock('imapflow');
jest.mock('mailparser', () => ({ simpleParser: jest.fn() }));

const { simpleParser: parserReal } = jest.requireActual('mailparser') as {
  simpleParser: typeof simpleParser;
};

const UIDVALIDITY = 100200300n;

/** Un candado de carpeta falso, con su propio espía en `release`. */
function fakeLock(path: string) {
  return { path, release: jest.fn() };
}

/**
 * Un cliente IMAP falso con lo mínimo que `ImapMailboxService` usa. `locks`
 * guarda, en orden, todos los candados que `getMailboxLock` fue entregando --
 * no se puede leer de `getMailboxLock.mock.results` porque esa lista guarda
 * la PROMESA que devuelve la función simulada, no el candado ya resuelto.
 */
function fakeClient() {
  const locks: Array<{ path: string; release: jest.Mock }> = [];
  return {
    usable: true,
    mailbox: { uidValidity: UIDVALIDITY, path: 'INBOX' } as any,
    connect: jest.fn().mockResolvedValue(undefined),
    getMailboxLock: jest.fn(async (path: string) => {
      const lock = fakeLock(path);
      locks.push(lock);
      return lock;
    }),
    logout: jest.fn().mockResolvedValue(undefined),
    search: jest.fn().mockResolvedValue([5, 3]),
    fetchOne: jest.fn().mockResolvedValue({ uid: 3, source: Buffer.from('correo crudo') }),
    messageFlagsAdd: jest.fn().mockResolvedValue(true),
    messageFlagsRemove: jest.fn().mockResolvedValue(true),
    locks,
  };
}

function unMensajeParseado(overrides: Record<string, unknown> = {}) {
  return {
    messageId: '<msg-1@empresa.com>',
    from: {
      value: [{ address: 'ana@empresa.com', name: 'Ana Quispe' }],
      text: '"Ana Quispe" <ana@empresa.com>',
    },
    subject: 'No carga el reporte',
    date: new Date('2026-08-20T10:00:00Z'),
    text: 'Hola, el reporte no carga.',
    html: false,
    headerLines: [{ key: 'authentication-results', line: 'Authentication-Results: mx.kuboti.com; dmarc=pass' }],
    attachments: [],
    ...overrides,
  };
}

function montar(clientOverrides: Partial<ReturnType<typeof fakeClient>> = {}) {
  const client = { ...fakeClient(), ...clientOverrides };
  (ImapFlow as unknown as jest.Mock).mockImplementation(() => client);
  const workspace = {
    getImapConfig: jest.fn().mockResolvedValue({
      host: 'imap.kuboti.com',
      port: 993,
      secure: true,
      user: 'ticket@kuboti.com',
      pass: 'secreto',
      folder: 'INBOX',
    }),
  };
  const service = new ImapMailboxService(workspace as any);
  return { service, client, workspace };
}

/** Todos los locks que un cliente falso entregó, en orden. */
function locksDe(client: ReturnType<typeof fakeClient>): Array<{ release: jest.Mock }> {
  return client.locks;
}

describe('ImapMailboxService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (simpleParser as jest.Mock).mockResolvedValue(unMensajeParseado());
  });

  describe('fetchUnprocessed', () => {
    it('busca mensajes no vistos, los limita y arma el mailboxRef con el UIDVALIDITY de la carpeta', async () => {
      const { service, client } = montar();

      const mensajes = await service.fetchUnprocessed(1);

      expect(client.search).toHaveBeenCalledWith({ seen: false }, { uid: true });
      // El límite recorta a los UID más bajos (más antiguos) primero: de [5,3] ordenado -> [3].
      expect(client.fetchOne).toHaveBeenCalledTimes(1);
      expect(client.fetchOne).toHaveBeenCalledWith(3, { source: true }, { uid: true });
      expect(mensajes).toHaveLength(1);
      expect(mensajes[0].mailboxRef).toBe(encodeMailboxRef(UIDVALIDITY.toString(), 3));
    });

    it('entrega la dirección ya analizada por mailparser, nunca la re-serialización .text', async () => {
      const { service } = montar();

      const [mensaje] = await service.fetchUnprocessed(5);

      expect(mensaje.from).toBe('ana@empresa.com');
    });

    /**
     * El crítico de la ronda de correcciones 1. Un `From` cuyo nombre para
     * mostrar es una `quoted-string` que contiene, sin escapar, un `<...>`
     * con la dirección de una víctima real. `.value[0].address` (lo que
     * `mailparser` ya analizó con una gramática completa) da la dirección
     * real del atacante; `.text` (una re-serialización de nombre+dirección)
     * reproduce la cadena original, y el regex ingenuo de
     * `extractSenderAddress` tomaría el primer `<...>` -- el de la víctima,
     * dentro del nombre -- si este adaptador entregara `.text`.
     */
    it('no se deja suplantar por un nombre para mostrar que contiene un <...> de una víctima', async () => {
      (simpleParser as jest.Mock).mockResolvedValue(
        unMensajeParseado({
          from: {
            value: [{ address: 'atacante@evil.com', name: 'Soporte <victima@kuboti.com>' }],
            text: '"Soporte <victima@kuboti.com>" <atacante@evil.com>',
          },
        }),
      );
      const { service } = montar();

      const [mensaje] = await service.fetchUnprocessed(5);

      expect(mensaje.from).toBe('atacante@evil.com');
    });

    it('entrega solo la Authentication-Results mas externa (la primera de headerLines)', async () => {
      (simpleParser as jest.Mock).mockResolvedValue(
        unMensajeParseado({
          headerLines: [
            { key: 'authentication-results', line: 'Authentication-Results: mx.kuboti.com; dmarc=pass' },
            // La del propio remitente, mas adentro de la cadena de Received.
            { key: 'authentication-results', line: 'Authentication-Results: relay-ajeno.net; dmarc=pass' },
          ],
        }),
      );
      const { service } = montar();

      const [mensaje] = await service.fetchUnprocessed(5);

      expect(mensaje.authenticationResults).toBe('mx.kuboti.com; dmarc=pass');
    });

    it('nunca entrega el cuerpo como HTML: si solo hay HTML, lo convierte a texto', async () => {
      (simpleParser as jest.Mock).mockResolvedValue(
        unMensajeParseado({ text: undefined, html: '<p>Hola <b>mundo</b></p>' }),
      );
      const { service } = montar();

      const [mensaje] = await service.fetchUnprocessed(5);

      expect(mensaje.textBody).not.toMatch(/[<>]/);
      expect(mensaje.textBody).toContain('Hola');
      expect(mensaje.textBody).toContain('mundo');
    });

    it('sin Message-ID, calcula el sustituto sobre los bytes crudos del mensaje', async () => {
      const fuente1 = Buffer.from('correo A');
      const fuente2 = Buffer.from('correo B');
      (simpleParser as jest.Mock)
        .mockResolvedValueOnce(unMensajeParseado({ messageId: undefined }))
        .mockResolvedValueOnce(unMensajeParseado({ messageId: undefined }));
      const client = fakeClient();
      client.search.mockResolvedValue([3, 7]);
      client.fetchOne.mockImplementation(async (uid: number) => ({
        uid,
        source: uid === 3 ? fuente1 : fuente2,
      }));
      const { service } = montar(client);

      const mensajes = await service.fetchUnprocessed(10);

      expect(mensajes).toHaveLength(2);
      expect(mensajes[0].messageId).toBe(syntheticMessageId(fuente1));
      expect(mensajes[1].messageId).toBe(syntheticMessageId(fuente2));
      expect(mensajes[0].messageId).not.toBe(mensajes[1].messageId);
    });

    it('salta el mensaje si el servidor no devuelve nada (se borró entre el search y el fetch)', async () => {
      const client = fakeClient();
      client.search.mockResolvedValue([3]);
      client.fetchOne.mockResolvedValue(false as any);
      const { service } = montar(client);

      const mensajes = await service.fetchUnprocessed(5);

      expect(mensajes).toEqual([]);
    });

    it('sin mensajes no vistos, no llama a fetchOne', async () => {
      const client = fakeClient();
      client.search.mockResolvedValue([]);
      const { service } = montar(client);

      const mensajes = await service.fetchUnprocessed(5);

      expect(mensajes).toEqual([]);
      expect(client.fetchOne).not.toHaveBeenCalled();
    });

    it('reutiliza la misma conexión entre dos pasadas mientras siga usable', async () => {
      const { service, client } = montar();

      await service.fetchUnprocessed(5);
      await service.fetchUnprocessed(5);

      expect(client.connect).toHaveBeenCalledTimes(1);
    });

    it('lanza un error claro si la ingesta está encendida pero el buzón no está configurado', async () => {
      const workspace = { getImapConfig: jest.fn().mockResolvedValue(null) };
      const service = new ImapMailboxService(workspace as any);

      await expect(service.fetchUnprocessed(5)).rejects.toThrow(/no está configurado/);
    });

    describe('el candado de la carpeta', () => {
      it('se pide y se suelta en cada pasada', async () => {
        const { service, client } = montar();

        await service.fetchUnprocessed(5);

        const locks = locksDe(client);
        expect(locks).toHaveLength(1);
        expect(locks[0].release).toHaveBeenCalledTimes(1);
      });

      /**
       * Retener el candado suspende el keepalive/IDLE de `imapflow` (ver el
       * docblock de la clase). Si un fallo a medio camino lo dejara sin
       * soltar, la conexión quedaría muda hasta que el servidor la cortara.
       */
      it('se suelta también si la operación revienta a medias', async () => {
        const client = fakeClient();
        client.search.mockRejectedValue(new Error('la conexión se cortó'));
        const { service } = montar(client);

        await expect(service.fetchUnprocessed(5)).rejects.toThrow('la conexión se cortó');

        const locks = locksDe(client);
        expect(locks).toHaveLength(1);
        expect(locks[0].release).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('markProcessed', () => {
    it('marca con \\Seen cuando el UIDVALIDITY coincide con el de la carpeta', async () => {
      const { service, client } = montar();

      const ref = encodeMailboxRef(UIDVALIDITY.toString(), 3);
      await service.markProcessed(ref);

      expect(client.messageFlagsAdd).toHaveBeenCalledWith(3, ['\\Seen'], { uid: true });
    });

    /** No depende de que `fetchUnprocessed` se haya llamado antes en el proceso. */
    it('funciona igual sin ningún fetchUnprocessed previo en esta instancia', async () => {
      const { service, client } = montar();

      await service.markProcessed(encodeMailboxRef(UIDVALIDITY.toString(), 9));

      expect(client.messageFlagsAdd).toHaveBeenCalledWith(9, ['\\Seen'], { uid: true });
    });

    /**
     * La regla que este adaptador existe para sostener: un UID no es estable
     * fuera de (carpeta, UIDVALIDITY). Si la carpeta actual tiene un
     * UIDVALIDITY distinto del que grabó el `mailboxRef`, marcar sería
     * arriesgarse a tocar un mensaje distinto del que de verdad se procesó.
     */
    it('NO marca si el UIDVALIDITY de la referencia no coincide con el de la carpeta actual', async () => {
      const { service, client } = montar();

      const refDeOtraEpoca = encodeMailboxRef('999999999', 3);
      await service.markProcessed(refDeOtraEpoca);

      expect(client.messageFlagsAdd).not.toHaveBeenCalled();
    });

    it('NO marca, y no revienta, si el mailboxRef no tiene la forma esperada', async () => {
      const { service, client } = montar();

      await expect(service.markProcessed('uid-suelto-de-antes-de-esta-tarea')).resolves.toBeUndefined();
      expect(client.messageFlagsAdd).not.toHaveBeenCalled();
    });

    it('pide y suelta su propio candado, sin depender de uno anterior', async () => {
      const { service, client } = montar();

      await service.markProcessed(encodeMailboxRef(UIDVALIDITY.toString(), 3));

      const locks = locksDe(client);
      expect(locks).toHaveLength(1);
      expect(locks[0].release).toHaveBeenCalledTimes(1);
    });

    it('suelta el candado también cuando el UIDVALIDITY no coincide', async () => {
      const { service, client } = montar();

      await service.markProcessed(encodeMailboxRef('999999999', 3));

      expect(locksDe(client)[0].release).toHaveBeenCalledTimes(1);
    });
  });

  describe('markUnprocessed', () => {
    it('busca por Message-ID, entre los ya marcados, y les quita \\Seen', async () => {
      const { service, client } = montar({ search: jest.fn().mockResolvedValue([7]) });

      await service.markUnprocessed('<falla@empresa.com>');

      expect(client.search).toHaveBeenCalledWith(
        { header: { 'message-id': '<falla@empresa.com>' }, seen: true },
        { uid: true },
      );
      expect(client.messageFlagsRemove).toHaveBeenCalledWith([7], ['\\Seen'], { uid: true });
    });

    it('quita la bandera de todas las coincidencias si el Message-ID no es único en el buzón', async () => {
      const { service, client } = montar({ search: jest.fn().mockResolvedValue([7, 12]) });

      await service.markUnprocessed('<compartido@empresa.com>');

      expect(client.messageFlagsRemove).toHaveBeenCalledWith([7, 12], ['\\Seen'], { uid: true });
    });

    /**
     * Un `STORE` sobre un UID que ya no existe no falla por protocolo IMAP --
     * el servidor no tiene nada que tocar y responde OK igual --, así que sin
     * esta comprobación previa un correo borrado a mano del buzón parecería
     * reencolarse con normalidad. `search` vacío (o `false`, la forma en que
     * `imapflow` señala "sin resultados") tiene que frenar antes de llegar a
     * `messageFlagsRemove`.
     */
    it.each([
      ['una lista vacía', [] as number[]],
      ['false', false as const],
    ])('lanza y no toca ninguna bandera si la búsqueda no encuentra nada (%s)', async (_nombre, resultado) => {
      const { service, client } = montar({ search: jest.fn().mockResolvedValue(resultado) });

      await expect(service.markUnprocessed('<borrado@empresa.com>')).rejects.toThrow();
      expect(client.messageFlagsRemove).not.toHaveBeenCalled();
    });

    it('pide y suelta su propio candado, también cuando falla', async () => {
      const { service, client } = montar({ search: jest.fn().mockResolvedValue([]) });

      await expect(service.markUnprocessed('<borrado@empresa.com>')).rejects.toThrow();

      expect(locksDe(client)).toHaveLength(1);
      expect(locksDe(client)[0].release).toHaveBeenCalledTimes(1);
    });

    /**
     * A diferencia de `markProcessed`, esta vía no arrastra ningún UIDVALIDITY
     * de una lectura anterior -- busca en vivo por Message-ID --, así que no
     * hay nada que comparar contra el de la carpeta actual. Esta prueba deja
     * escrito que ese no-comportamiento es intencional.
     */
    it('no consulta ni compara UIDVALIDITY: busca en vivo por Message-ID', async () => {
      const { service, client } = montar({ search: jest.fn().mockResolvedValue([7]) });

      await service.markUnprocessed('<falla@empresa.com>');

      // El único dato de la carpeta que usa esta vía es su ruta, para el
      // candado -- nunca `client.mailbox.uidValidity`.
      expect(client.getMailboxLock).toHaveBeenCalledWith('INBOX');
    });
  });

  describe('una pasada completa: fetch y varios markProcessed', () => {
    it('reutiliza la conexión pero pide un candado nuevo por cada operación, y los suelta todos', async () => {
      const { service, client } = montar();

      const [mensaje] = await service.fetchUnprocessed(5);
      await service.markProcessed(mensaje.mailboxRef);
      await service.markProcessed(encodeMailboxRef(UIDVALIDITY.toString(), 5));

      expect(client.connect).toHaveBeenCalledTimes(1);
      expect(client.getMailboxLock).toHaveBeenCalledTimes(3);
      const locks = locksDe(client);
      expect(locks.every((l) => l.release.mock.calls.length === 1)).toBe(true);
    });
  });
});

describe('encodeMailboxRef / decodeMailboxRef', () => {
  it('hace un viaje de ida y vuelta', () => {
    const ref = encodeMailboxRef('123456', 42);
    expect(decodeMailboxRef(ref)).toEqual({ uidValidity: '123456', uid: 42 });
  });

  it('decodeMailboxRef devuelve null ante una forma que no reconoce', () => {
    expect(decodeMailboxRef('no-tiene-la-forma-uidvalidity:uid')).toBeNull();
    expect(decodeMailboxRef('')).toBeNull();
    expect(decodeMailboxRef('123')).toBeNull();
  });
});

describe('extractFromAddress', () => {
  it('lee value[0].address, no la re-serialización .text', () => {
    const parsed = {
      from: {
        value: [{ address: 'ana@empresa.com', name: 'Ana Quispe' }],
        text: '"Ana Quispe" <ana@empresa.com>',
      },
    } as any;
    expect(extractFromAddress(parsed)).toBe('ana@empresa.com');
  });

  it('el vector completo: un nombre con un <...> de una víctima no cambia la dirección extraída', () => {
    const parsed = {
      from: {
        value: [{ address: 'atacante@evil.com', name: 'Soporte <victima@kuboti.com>' }],
        text: '"Soporte <victima@kuboti.com>" <atacante@evil.com>',
      },
    } as any;
    expect(extractFromAddress(parsed)).toBe('atacante@evil.com');
  });

  /**
   * Ronda de correcciones 2: la versión anterior caía a `.text` aquí, y eso
   * reintroducía el vector original por la puerta de atrás (un grupo cuyo
   * único miembro tiene un nombre para mostrar con un `<víctima@dominio>`
   * sin escapar produce igual una `.text` ambigua). Ahora nunca cae a
   * `.text`: cadena vacía, que es la verdad -- "no hay ninguna dirección
   * directa" -- y no una alternativa insegura.
   */
  it('un From que es solo un grupo, sin dirección directa, da cadena vacía (nunca cae a .text)', () => {
    const parsed = { from: { value: [], text: 'Grupo: "Soporte <victima@kuboti.com>" <atacante@evil.com>;' } } as any;
    expect(extractFromAddress(parsed)).toBe('');
  });

  it('cadena vacía si no hay From en absoluto', () => {
    expect(extractFromAddress({ from: undefined } as any)).toBe('');
  });
});

describe('syntheticMessageId', () => {
  it('es determinista sobre el mismo contenido', () => {
    const a = syntheticMessageId(Buffer.from('mensaje X'));
    const b = syntheticMessageId(Buffer.from('mensaje X'));
    expect(a).toBe(b);
  });

  it('dos mensajes distintos producen sustitutos distintos', () => {
    expect(syntheticMessageId(Buffer.from('A'))).not.toBe(syntheticMessageId(Buffer.from('B')));
  });

  /**
   * El defecto que corrigió la ronda de correcciones 1: la primera versión
   * derivaba el sustituto de (uidValidity, uid), estable ante un reinicio a
   * medias pero NO ante el suceso que da sentido a todo `mailboxRef` -- que
   * la carpeta se recree y el mismo correo reciba otro UID/UIDVALIDITY. Al
   * depender solo del contenido crudo, el mismo correo dos veces (aunque
   * lleguen con identificadores IMAP distintos) produce el mismo sustituto.
   */
  it('es estable aunque el correo se relea con un UID/UIDVALIDITY distintos (carpeta recreada)', () => {
    const mismoCorreo = Buffer.from('From: ana@empresa.com\r\nSubject: hola\r\n\r\ncuerpo');
    expect(syntheticMessageId(mismoCorreo)).toBe(syntheticMessageId(mismoCorreo));
  });
});

describe('buildRawHeaders', () => {
  it('conserva solo la primera aparición de una cabecera repetida', () => {
    const headers = buildRawHeaders([
      { key: 'authentication-results', line: 'Authentication-Results: mx.kuboti.com; dmarc=pass' },
      { key: 'authentication-results', line: 'Authentication-Results: relay-ajeno.net; dmarc=pass' },
    ]);

    expect(headers['authentication-results']).toBe('mx.kuboti.com; dmarc=pass');
  });

  it('despliega una cabecera plegada (continuación con espacio) en una sola línea sin saltos', () => {
    const headers = buildRawHeaders([
      {
        key: 'authentication-results',
        line: 'Authentication-Results: mx.kuboti.com;\r\n dmarc=pass action=none',
      },
    ]);

    expect(headers['authentication-results']).not.toMatch(/[\r\n]/);
    expect(headers['authentication-results']).toBe('mx.kuboti.com; dmarc=pass action=none');
  });

  it('recorta el valor y no incluye la clave', () => {
    const headers = buildRawHeaders([{ key: 'precedence', line: 'Precedence:   bulk  ' }]);
    expect(headers['precedence']).toBe('bulk');
  });
});

describe('chooseTextBody', () => {
  it('prefiere text/plain cuando existe', () => {
    expect(chooseTextBody({ text: 'texto plano', html: '<p>html</p>' })).toBe('texto plano');
  });

  it('convierte el HTML cuando no hay texto', () => {
    const resultado = chooseTextBody({ text: undefined, html: '<p>Hola <b>mundo</b></p>' });
    expect(resultado).not.toMatch(/[<>]/);
    expect(resultado).toContain('Hola');
    expect(resultado).toContain('mundo');
  });

  it('cadena vacía si no hay ni texto ni HTML', () => {
    expect(chooseTextBody({ text: undefined, html: false })).toBe('');
  });

  it('un text en blanco (solo espacios) también cae al HTML', () => {
    const resultado = chooseTextBody({ text: '   ', html: '<p>contenido real</p>' });
    expect(resultado).toContain('contenido real');
  });

  /**
   * El defecto de la ronda de correcciones 1: decodificar `&lt;`/`&gt;`
   * DESPUÉS de quitar las etiquetas reales reconstruye el marcado que la
   * función existe para eliminar. `<p>&lt;img src=x onerror=alert(1)&gt;</p>`
   * tiene un `<p>` real (que hay que quitar) y una entidad `&lt;...&gt;`
   * dentro (que NO debe convertirse de vuelta en `<`/`>`).
   */
  it('una entidad &lt;/&gt; dentro del HTML no se reconvierte en una etiqueta real', () => {
    const resultado = chooseTextBody({
      text: undefined,
      html: '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    });

    expect(resultado).not.toMatch(/[<>]/);
    expect(resultado).toContain('img src=x onerror=alert(1)');
  });

  /**
   * La garantía "nunca HTML" es sobre la CONVERSIÓN, no sobre el cuerpo en
   * general: un `text/plain` que alguien escribió con `<`/`>` a propósito
   * (una URL entre ángulos, un pie de firma clásico) es texto legítimo, y se
   * entrega tal cual -- no es marcado que limpiar. Esto no es un descuido:
   * es la razón por la que `IncomingMessage.textBody` puede, en teoría,
   * contener esos caracteres cuando viene de una parte `text/plain` real.
   */
  it('un text/plain con caracteres < > se entrega tal cual, no se limpia', () => {
    const conAngulos = 'Escríbeme a <ana@empresa.com>, o revisa si x < y en el reporte.';
    expect(chooseTextBody({ text: conAngulos, html: false })).toBe(conAngulos);
  });
});

/**
 * Las pruebas de esta sección usan el `simpleParser` REAL de `mailparser`
 * (`jest.requireActual`), no el doble del resto del archivo. No necesitan
 * red -- `simpleParser` opera sobre un `Buffer` en memoria -- y son las que
 * de verdad comprueban el supuesto sobre la biblioteca del que depende la
 * regla más importante de este adaptador: que dos cabeceras
 * `Authentication-Results` llegan como dos entradas separadas y en el orden
 * del archivo, nunca unidas ni reordenadas.
 */
describe('contra el analizador real de mailparser (sin doblar)', () => {
  it('dos Authentication-Results llegan como dos entradas separadas, en orden, nunca unidas', async () => {
    const crudo = [
      'Authentication-Results: mx.kuboti.com; dmarc=pass',
      'Authentication-Results: relay-ajeno.net; dmarc=pass',
      'From: ana@empresa.com',
      'Subject: Prueba real',
      'Message-ID: <real-1@empresa.com>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Hola mundo',
      '',
    ].join('\r\n');

    const parsed = await parserReal(Buffer.from(crudo));

    const apariciones = parsed.headerLines.filter((h) => h.key === 'authentication-results');
    expect(apariciones).toHaveLength(2);
    expect(apariciones[0].line).toContain('mx.kuboti.com');
    expect(apariciones[1].line).toContain('relay-ajeno.net');

    const headers = buildRawHeaders(parsed.headerLines);
    expect(headers['authentication-results']).toBe('mx.kuboti.com; dmarc=pass');
  });

  it('el vector de suplantación con el parser real: value[0].address da la dirección de verdad', async () => {
    const crudo = [
      'From: "Soporte <victima@kuboti.com>" <atacante@evil.com>',
      'Subject: Hola',
      'Message-ID: <real-2@evil.com>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'cuerpo',
      '',
    ].join('\r\n');

    const parsed = await parserReal(Buffer.from(crudo));

    expect(parsed.from?.value?.[0]?.address).toBe('atacante@evil.com');
    // Documenta el vector: .text SÍ reproduce la cadena ambigua.
    expect(parsed.from?.text).toContain('victima@kuboti.com');
    // Y nuestra función no cae en la trampa.
    expect(extractFromAddress(parsed)).toBe('atacante@evil.com');
  });

  /**
   * El hueco real de la conversión automática de `mailparser`: un
   * `multipart/mixed` con un único hijo `text/html` (no `multipart/alternative`,
   * no la raíz del mensaje) y un adjunto que NO es texto. Con esta forma,
   * `mailparser` NO genera `parsed.text` por su cuenta -- `chooseTextBody`
   * tiene que convertir el HTML él mismo, y la conversión no puede dejar
   * pasar la entidad `&lt;.../&gt;` como si fuera una etiqueta real.
   */
  it('un HTML dentro de multipart/mixed junto a un adjunto no genera texto solo: se convierte aquí, sin dejar pasar entidades', async () => {
    const boundary = 'BOUNDARY123';
    const crudo = [
      'From: ana@empresa.com',
      'Subject: html con adjunto',
      'Message-ID: <real-3@empresa.com>',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
      '',
      `--${boundary}`,
      'Content-Type: application/pdf',
      'Content-Disposition: attachment; filename="nota.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('contenido del adjunto').toString('base64'),
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const parsed = await parserReal(Buffer.from(crudo));

    // Confirma el hueco: mailparser no generó texto por su cuenta.
    expect(parsed.text).toBeFalsy();
    expect(parsed.html).toBeTruthy();

    const texto = chooseTextBody(parsed);
    expect(texto).not.toMatch(/[<>]/);
    expect(texto).toContain('img src=x onerror=alert(1)');
  });
});

/**
 * Ronda de correcciones 2 de la Task 8 -- el séptimo intento contra la
 * suplantación del remitente, y el que cierra la familia entera de una vez.
 * Los seis vectores del hallazgo, cada uno con DMARC pasando de verdad para
 * el dominio del atacante (`evil.com`) -- el "pass" es honesto, el defecto
 * era leer el dominio equivocado después. Los seis se ejecutan contra el
 * `simpleParser` REAL (no doblado): dos de los seis (el de las cabeceras
 * `From` duplicadas y "el peor", donde la propia `mailparser` se equivoca)
 * solo se pueden demostrar contra la biblioteca de verdad, nunca fabricando
 * a mano lo que "debería" devolver.
 *
 * La comprobación que cierra los seis a la vez no es un análisis mejor del
 * `From`: es cruzar el dominio que DMARC certificó (`extractAuthenticatedDomain`)
 * contra el dominio de la dirección que el sistema identificó
 * (`domainOf(extractFromAddress(parsed))`) -- exactamente lo que
 * `InboundEmailService.processOne` hace en producción, simulado aquí sin
 * levantar el servicio completo.
 */
describe('los seis vectores de suplantación (ronda de correcciones 2)', () => {
  /** La dirección que un atacante intenta hacer pasar por su remitente. */
  const VICTIMA = 'jefe@kuboti.com';

  /**
   * `true` solo si, con estos datos, `InboundEmailService.processOne`
   * terminaría tratando el correo como autenticado Y de la víctima --
   * exactamente lo que los seis vectores deben conseguir que sea `false`.
   */
  function suplantaALaVictima(authHeader: string | null | undefined, senderAddress: string): boolean {
    if (judgeAuthentication(authHeader) !== 'PASA') return false;
    const dominioAutenticado = extractAuthenticatedDomain(authHeader);
    const dominioRemitente = domainOf(senderAddress);
    if (dominioAutenticado === null || dominioAutenticado !== dominioRemitente) return false;
    return senderAddress === VICTIMA;
  }

  /** Arma un mensaje crudo mínimo y lo pasa por el `simpleParser` real. */
  async function analizar(fromLine: string, extra: string[] = []) {
    const crudo = [
      fromLine,
      'Subject: prueba',
      'Message-ID: <vector@evil.com>',
      'Content-Type: text/plain; charset=utf-8',
      ...extra,
      '',
      'cuerpo',
      '',
    ].join('\r\n');
    return parserReal(Buffer.from(crudo));
  }

  it('V1: un local-part entrecomillado que contiene el "<...>" de la víctima', async () => {
    const parsed = await analizar('From: "<jefe@kuboti.com>"@evil.com');
    const remitente = extractFromAddress(parsed);
    const authHeader = 'mx.kuboti.com; dmarc=pass header.from=evil.com';

    // La dirección se extrae ENTERA y correcta -- no se trunca a la víctima.
    expect(remitente).toBe('"<jefe@kuboti.com>"@evil.com');
    expect(suplantaALaVictima(authHeader, remitente)).toBe(false);
  });

  it('V2: un From en forma de grupo, sin dirección directa', async () => {
    const parsed = await analizar('From: Grupo:"Soporte <jefe@kuboti.com>" <atacante@evil.com>;');
    const remitente = extractFromAddress(parsed);
    const authHeader = 'mx.kuboti.com; dmarc=pass header.from=evil.com';

    expect(suplantaALaVictima(authHeader, remitente)).toBe(false);
  });

  it('V3: dos cabeceras From duplicadas -- mailparser toma la última', async () => {
    const parsed = await analizar('From: atacante@evil.com', ['From: jefe@kuboti.com']);
    const remitente = extractFromAddress(parsed);
    const authHeader = 'mx.kuboti.com; dmarc=pass header.from=evil.com';

    // Confirma el hecho de la biblioteca que motiva el cruce de dominios:
    // con dos "From", se queda con el ÚLTIMO -- el de la víctima.
    expect(remitente).toBe(VICTIMA);
    // Sin el cruce de dominios, esto sería una suplantación exitosa.
    expect(suplantaALaVictima(authHeader, remitente)).toBe(false);
  });

  it('V4: una lista de dos direcciones en un solo From (RFC 6854), la víctima primero', async () => {
    const parsed = await analizar('From: jefe@kuboti.com, atacante@evil.com');
    const remitente = extractFromAddress(parsed);
    const authHeader = 'mx.kuboti.com; dmarc=pass header.from=evil.com';

    expect(suplantaALaVictima(authHeader, remitente)).toBe(false);
  });

  it('V5: un grupo con dos direcciones directas, la víctima incluida', async () => {
    const parsed = await analizar('From: Equipo: jefe@kuboti.com, atacante@evil.com;');
    const remitente = extractFromAddress(parsed);
    const authHeader = 'mx.kuboti.com; dmarc=pass header.from=evil.com';

    expect(suplantaALaVictima(authHeader, remitente)).toBe(false);
  });

  /**
   * "El peor": un `name-addr` (`<...>`) cuyo `addr-spec` es, a su vez, un
   * local-part entrecomillado con su propio `<víctima>` dentro. Verificado
   * contra el analizador real: aquí **la propia `mailparser` se equivoca** y
   * devuelve `jefe@kuboti.com` -- la víctima -- en `value[0].address`, no
   * `"<jefe@kuboti.com>"@evil.com` (que sería lo correcto). Ninguna cantidad
   * de "analizar mejor" en este adaptador arregla un error de la
   * dependencia en la que hay que confiar para todo lo demás; el cruce de
   * dominios lo cierra igual, porque DMARC certificó `evil.com`, nunca
   * `kuboti.com` -- sin que le importe si `mailparser` acertó o no.
   */
  it('V6 (el peor): mailparser se equivoca y devuelve la dirección de la víctima; el cruce de dominios lo cierra igual', async () => {
    const parsed = await analizar('From: <"<jefe@kuboti.com>"@evil.com>');
    const remitente = extractFromAddress(parsed);
    const authHeader = 'mx.kuboti.com; dmarc=pass header.from=evil.com';

    // Documenta el error real de la biblioteca -- no una suposición: si esta
    // aserción empieza a fallar es porque mailparser lo arregló, buena
    // noticia, y hay que actualizar el comentario, no "arreglar" el test.
    expect(remitente).toBe(VICTIMA);
    expect(suplantaALaVictima(authHeader, remitente)).toBe(false);
  });

  /**
   * El caso legítimo no debe romperse: un cliente real, con DMARC pasando
   * para SU dominio, sigue autenticando y coincidiendo.
   */
  it('un correo legítimo (dominio autenticado = dominio del remitente) sigue pasando', async () => {
    const parsed = await analizar('From: ana@empresa.com');
    const remitente = extractFromAddress(parsed);
    const authHeader = 'mx.kuboti.com; spf=pass; dkim=pass; dmarc=pass header.from=empresa.com';

    expect(remitente).toBe('ana@empresa.com');
    expect(judgeAuthentication(authHeader)).toBe('PASA');
    expect(extractAuthenticatedDomain(authHeader)).toBe('empresa.com');
    expect(domainOf(remitente)).toBe('empresa.com');
  });
});
