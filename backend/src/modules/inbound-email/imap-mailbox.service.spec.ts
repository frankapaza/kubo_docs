import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import {
  ImapMailboxService,
  buildRawHeaders,
  chooseTextBody,
  decodeMailboxRef,
  encodeMailboxRef,
} from './imap-mailbox.service';

/**
 * `imapflow` y `mailparser` van con doble: este archivo prueba la traducción
 * -- construcción de `mailboxRef`, la comprobación de UIDVALIDITY al marcar,
 * y las tres funciones puras que sostienen las reglas más importantes del
 * adaptador (Authentication-Results, texto nunca HTML) -- sin abrir ninguna
 * conexión de verdad. `ImapMailboxService` es la única pieza de la ingesta
 * que de verdad necesita un buzón real delante; por eso es también la única
 * que este proyecto no prueba con el recorrido completo (ese lo cubre
 * `inbound-email.service.spec.ts`, con el doble trivial de `Mailbox`).
 */
jest.mock('imapflow');
jest.mock('mailparser', () => ({ simpleParser: jest.fn() }));

const UIDVALIDITY = 100200300n;

/** Un cliente IMAP falso con lo mínimo que `ImapMailboxService` usa. */
function fakeClient() {
  return {
    usable: true,
    mailbox: { uidValidity: UIDVALIDITY, path: 'INBOX' },
    connect: jest.fn().mockResolvedValue(undefined),
    getMailboxLock: jest.fn().mockResolvedValue({ path: 'INBOX', release: jest.fn() }),
    logout: jest.fn().mockResolvedValue(undefined),
    search: jest.fn().mockResolvedValue([5, 3]),
    fetchOne: jest.fn().mockResolvedValue({ uid: 3, source: Buffer.from('correo crudo') }),
    messageFlagsAdd: jest.fn().mockResolvedValue(true),
  };
}

function unMensajeParseado(overrides: Record<string, unknown> = {}) {
  return {
    messageId: '<msg-1@empresa.com>',
    from: { text: '"Ana Quispe" <ana@empresa.com>' },
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

describe('ImapMailboxService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (simpleParser as jest.Mock).mockResolvedValue(unMensajeParseado());
  });

  describe('fetchUnprocessed', () => {
    it('busca mensajes no vistos, los limita y arma el mailboxRef con el UIDVALIDITY de la sesión', async () => {
      const { service, client } = montar();

      const mensajes = await service.fetchUnprocessed(1);

      expect(client.search).toHaveBeenCalledWith({ seen: false }, { uid: true });
      // El límite recorta a los UID más bajos (más antiguos) primero: de [5,3] ordenado -> [3].
      expect(client.fetchOne).toHaveBeenCalledTimes(1);
      expect(client.fetchOne).toHaveBeenCalledWith(3, { source: true }, { uid: true });
      expect(mensajes).toHaveLength(1);
      expect(mensajes[0].mailboxRef).toBe(encodeMailboxRef(UIDVALIDITY.toString(), 3));
    });

    it('entrega el From tal cual, sin desenvolver la dirección (eso lo hace domain/message-headers.ts)', async () => {
      const { service } = montar();

      const [mensaje] = await service.fetchUnprocessed(5);

      expect(mensaje.from).toBe('"Ana Quispe" <ana@empresa.com>');
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

    it('un mensaje sin Message-ID recibe un sustituto determinista, no uno constante', async () => {
      (simpleParser as jest.Mock)
        .mockResolvedValueOnce(unMensajeParseado({ messageId: undefined }))
        .mockResolvedValueOnce(unMensajeParseado({ messageId: undefined }));
      const client = fakeClient();
      client.search.mockResolvedValue([3, 7]);
      client.fetchOne.mockImplementation(async (uid: number) => ({
        uid,
        source: Buffer.from('correo'),
      }));
      const { service } = montar(client);

      const mensajes = await service.fetchUnprocessed(10);

      expect(mensajes).toHaveLength(2);
      expect(mensajes[0].messageId).not.toBe(mensajes[1].messageId);
      expect(mensajes[0].messageId.length).toBeGreaterThan(0);
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
  });

  describe('markProcessed', () => {
    it('marca con \\Seen cuando el UIDVALIDITY coincide con el de la sesión que leyó el correo', async () => {
      const { service, client } = montar();
      await service.fetchUnprocessed(5); // abre la sesión y fija su UIDVALIDITY

      const ref = encodeMailboxRef(UIDVALIDITY.toString(), 3);
      await service.markProcessed(ref);

      expect(client.messageFlagsAdd).toHaveBeenCalledWith(3, ['\\Seen'], { uid: true });
    });

    /**
     * La regla que este adaptador existe para sostener: un UID no es estable
     * fuera de (carpeta, UIDVALIDITY). Si la sesión actual tiene un
     * UIDVALIDITY distinto del que grabó el `mailboxRef`, marcar sería
     * arriesgarse a tocar un mensaje distinto del que de verdad se procesó.
     */
    it('NO marca si el UIDVALIDITY de la referencia no coincide con el de la sesión actual', async () => {
      const { service, client } = montar();
      await service.fetchUnprocessed(5);

      const refDeOtraEpoca = encodeMailboxRef('999999999', 3);
      await service.markProcessed(refDeOtraEpoca);

      expect(client.messageFlagsAdd).not.toHaveBeenCalled();
    });

    it('NO marca si todavía no hay ninguna sesión abierta', async () => {
      const { service, client } = montar();

      await service.markProcessed(encodeMailboxRef(UIDVALIDITY.toString(), 3));

      expect(client.messageFlagsAdd).not.toHaveBeenCalled();
    });

    it('NO marca, y no revienta, si el mailboxRef no tiene la forma esperada', async () => {
      const { service, client } = montar();
      await service.fetchUnprocessed(5);

      await expect(service.markProcessed('uid-suelto-de-antes-de-esta-tarea')).resolves.toBeUndefined();
      expect(client.messageFlagsAdd).not.toHaveBeenCalled();
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
});
