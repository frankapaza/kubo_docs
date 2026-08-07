import { validateHeaderValue } from 'http';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Response } from 'express';
import { PassThrough, Readable, Writable } from 'stream';

import { STORAGE_SERVICE } from '../audio/interfaces/storage.interface';
import { ClientJwtGuard } from '../portal/guards/client-jwt.guard';
import { ClientJwtStrategy } from '../portal/strategies/client-jwt.strategy';
import { SlaService } from '../tickets/sla.service';
import { TicketEventsService } from '../tickets/ticket-events.service';
import { TicketsRepository } from '../tickets/tickets.repository';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { AttachmentUploadErrorsInterceptor } from './interceptors/attachment-upload-errors.interceptor';
import { PortalMessagesController } from './portal-messages.controller';
import { TicketAttachmentsService } from './ticket-attachments.service';
import { TicketMessagesModule } from './ticket-messages.module';
import { TicketMessagesRepository } from './ticket-messages.repository';
import { TicketMessagesService } from './ticket-messages.service';

/** El usuario del token, tal y como lo deja `ClientJwtGuard` en la petición. */
const CLIENTE = {
  clientUserId: 42,
  email: 'portal.test@clienteprueba.pe',
  clientId: 7,
  isClientAdmin: false,
};

/** El actor que ese token tiene que producir. Los **dos** identificadores. */
const ACTOR = { kind: 'CLIENT', clientUserId: 42, clientId: 7 };

const controllerPrototype = PortalMessagesController.prototype as unknown as Record<
  string,
  (...args: unknown[]) => unknown
>;

/** Dobles mínimos de los dos servicios: cada método, un `jest.fn` propio. */
function makeController() {
  const messages = { post: jest.fn(), listThread: jest.fn() };
  const attachments = { upload: jest.fn(), download: jest.fn(), list: jest.fn() };
  const controller = new PortalMessagesController(messages as any, attachments as any);
  return { controller, messages, attachments };
}

/** Una fila del hilo tal y como sale de la base, con más columnas de las que se publican. */
function makeMessage(over: Record<string, unknown> = {}) {
  return {
    id: 11,
    ticketId: 4,
    bodyMd: 'hola',
    visibility: 'PUBLICA',
    authorUserId: null,
    authorClientUserId: 42,
    createdAt: new Date('2026-08-06T10:00:00.000Z'),
    ...over,
  } as any;
}

/** Lo que devuelve `TicketAttachmentsService`: la proyección del servicio, con `messageId`. */
function makeSummary(over: Record<string, unknown> = {}) {
  return {
    id: 100,
    messageId: 11,
    filename: 'captura.png',
    mimeType: 'image/png',
    size: 1234,
    createdAt: new Date('2026-08-06T10:01:00.000Z'),
    ...over,
  } as any;
}

/** Un fichero tal y como lo deja multer en memoria. */
function makeMulterFile(over: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'captura.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 9,
    buffer: Buffer.from('no importa'),
    stream: null as any,
    destination: '',
    filename: '',
    path: '',
    ...over,
  } as Express.Multer.File;
}

/**
 * Un doble de `Response` que es un `Writable` de verdad, con `setHeader`
 * encima. Mismo motivo que en el spec del panel: lo que hay que comprobar de
 * `stream.pipeline` es comportamiento real de flujos.
 */
function makeResponse() {
  const headers = new Map<string, string>();
  const recibido: Buffer[] = [];

  const res = new Writable({
    write(chunk: Buffer, _enc, cb) {
      recibido.push(Buffer.from(chunk));
      cb();
    },
  });

  const setHeader = jest.fn((name: string, value: string) => {
    headers.set(name.toLowerCase(), value);
  });
  Object.assign(res, { setHeader });
  res.on('error', () => undefined);

  return {
    res: res as unknown as Response & { setHeader: typeof setHeader },
    headers,
    setHeader,
    cuerpo: () => Buffer.concat(recibido),
  };
}

/** Lo que devuelve `TicketAttachmentsService.download`, con sus **dos** nombres. */
function makeDownload(over: Record<string, unknown> = {}) {
  const stream = new PassThrough();
  stream.on('error', () => undefined);
  stream.end('los bytes del fichero');
  return {
    stream,
    filename: 'captura.png',
    headerFilename: 'captura.png',
    mimeType: 'image/png',
    size: 1234,
    ...over,
  } as any;
}

describe('PortalMessagesController — la puerta', () => {
  it('cuelga de `portal` y lleva ClientJwtGuard, como el resto del portal', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PortalMessagesController)).toBe('portal');
    expect(Reflect.getMetadata(GUARDS_METADATA, PortalMessagesController)).toEqual([ClientJwtGuard]);
  });

  it('el módulo se monta de verdad con el controlador del portal dentro', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TicketMessagesModule,
      ],
    })
      .useMocker((token) =>
        token === getDataSourceToken()
          ? { entityMetadatas: [], options: { type: 'mysql' }, getRepository: () => ({}) }
          : undefined,
      )
      .compile();

    expect(moduleRef.get(PortalMessagesController)).toBeInstanceOf(PortalMessagesController);
    await moduleRef.close();
  });
});

describe('PortalMessagesController — el actor sale del token, siempre', () => {
  it('leer el hilo pide el mismo actor a los dos servicios, con los dos identificadores', async () => {
    const { controller, messages, attachments } = makeController();
    messages.listThread.mockResolvedValue([]);
    attachments.list.mockResolvedValue([]);

    await controller.listThread(CLIENTE, 4);

    expect(messages.listThread).toHaveBeenCalledWith(ACTOR, 4);
    expect(attachments.list).toHaveBeenCalledWith(ACTOR, 4);
  });

  it('el actor sale del token de cada petición, no de un valor fijo', async () => {
    const { controller, messages, attachments } = makeController();
    messages.listThread.mockResolvedValue([]);
    attachments.list.mockResolvedValue([]);

    await controller.listThread({ ...CLIENTE, clientUserId: 99, clientId: 3 }, 4);

    expect(messages.listThread).toHaveBeenCalledWith(
      { kind: 'CLIENT', clientUserId: 99, clientId: 3 },
      4,
    );
  });

  /**
   * El controlador **no** comprueba los identificadores del token: eso lo hace
   * `resolveScope`, que falla cerrado con un 401. Un `if` aquí sería la quinta
   * aparición del defecto de este módulo -- una segunda copia de una decisión
   * ya tomada, que es la que se quedará vieja.
   */
  it('no valida los identificadores: los reparte tal cual y deja que el servicio falle cerrado', async () => {
    const { controller, messages, attachments } = makeController();
    messages.listThread.mockResolvedValue([]);
    attachments.list.mockResolvedValue([]);

    await controller.listThread({ ...CLIENTE, clientUserId: 0, clientId: 0 } as any, 4);

    expect(messages.listThread).toHaveBeenCalledWith(
      { kind: 'CLIENT', clientUserId: 0, clientId: 0 },
      4,
    );
  });

  it('escribir en el hilo va con el mismo actor', async () => {
    const { controller, messages } = makeController();
    messages.post.mockResolvedValue({ message: makeMessage(), ticket: { status: 'EN_ATENCION' } });

    await controller.post(CLIENTE, 4, { bodyMd: 'hola' });

    expect(messages.post.mock.calls[0][0]).toEqual(ACTOR);
    expect(messages.post.mock.calls[0][1]).toBe(4);
  });

  it('subir un adjunto va con el mismo actor', async () => {
    const { controller, attachments } = makeController();
    attachments.upload.mockResolvedValue(makeSummary());

    await controller.upload(CLIENTE, 4, 11, makeMulterFile());

    expect(attachments.upload.mock.calls[0][0]).toEqual(ACTOR);
  });

  it('descargar va con el mismo actor', async () => {
    const { controller, attachments } = makeController();
    attachments.download.mockResolvedValue(makeDownload());
    const { res } = makeResponse();

    await controller.download(CLIENTE, 3, res as any);

    expect(attachments.download).toHaveBeenCalledWith(ACTOR, 3);
  });
});

describe('PortalMessagesController.post — el cuerpo no fija la visibilidad', () => {
  /**
   * Lo que se le pasa al servicio lleva **solo** `bodyMd`. Ni `visibility:
   * undefined`: el DTO del portal no declara el campo y el controlador no lo
   * reenvía, así que ni siquiera existe la clave por la que colarlo.
   */
  it('al servicio solo le llega el cuerpo del mensaje, sin ninguna otra clave', async () => {
    const { controller, messages } = makeController();
    messages.post.mockResolvedValue({ message: makeMessage(), ticket: { status: 'EN_ATENCION' } });

    await controller.post(CLIENTE, 4, { bodyMd: 'hola' });

    expect(Object.keys(messages.post.mock.calls[0][2])).toEqual(['bodyMd']);
    expect(messages.post.mock.calls[0][2]).toEqual({ bodyMd: 'hola' });
  });

  it('una visibilidad colada en el DTO no viaja al servicio', async () => {
    // Aunque el `ValidationPipe` ya la rechaza (hay un test de integración que
    // lo comprueba), el controlador tampoco la reenviaría: no la lee.
    const { controller, messages } = makeController();
    messages.post.mockResolvedValue({ message: makeMessage(), ticket: { status: 'EN_ATENCION' } });

    await controller.post(CLIENTE, 4, { bodyMd: 'hola', visibility: 'INTERNA' } as any);

    expect(Object.keys(messages.post.mock.calls[0][2])).toEqual(['bodyMd']);
  });

  it('devuelve el mensaje proyectado y el estado en que queda el ticket, nada más', async () => {
    const { controller, messages } = makeController();
    messages.post.mockResolvedValue({
      message: makeMessage({ id: 12, bodyMd: 'sigue fallando' }),
      // El ticket entero, con todo lo que el portal no publica.
      ticket: {
        id: 4,
        status: 'EN_ATENCION',
        priority: 'ALTA',
        assigneeUserId: 9,
        slaResponseDueAt: new Date(),
        rawText: 'notas internas del equipo',
      },
    });

    const salida: any = await controller.post(CLIENTE, 4, { bodyMd: 'sigue fallando' });

    expect(Object.keys(salida)).toEqual(['message', 'ticketStatus']);
    expect(salida.ticketStatus).toBe('EN_ATENCION');
    expect(Object.keys(salida.message)).toEqual([
      'id',
      'bodyMd',
      'author',
      'createdAt',
      'attachments',
    ]);
    const crudo = JSON.stringify(salida);
    for (const interno of ['priority', 'assigneeUserId', 'slaResponseDueAt', 'rawText', 'visibility']) {
      expect(crudo).not.toContain(interno);
    }
  });
});

describe('PortalMessagesController.upload', () => {
  it('cuelga el adjunto del mensaje de la ruta y le pasa el fichero al servicio', async () => {
    const { controller, attachments } = makeController();
    attachments.upload.mockResolvedValue(makeSummary());
    const file = makeMulterFile({ originalname: 'factura.pdf', mimetype: 'application/pdf' });

    await controller.upload(CLIENTE, 4, 11, file);

    expect(attachments.upload).toHaveBeenCalledWith(ACTOR, 4, 11, {
      buffer: file.buffer,
      declaredMime: 'application/pdf',
      filename: 'factura.pdf',
      declaredSize: file.size,
    });
  });

  /**
   * El portal sube desde un navegador, así que le llega el mismo mojibake que
   * al panel: busboy decodifica el `filename=` del multipart como latin1. La
   * decodificación es **la misma función**, no una copia -- si hubiera dos, se
   * arreglaría una.
   */
  it('rescata el nombre del latin1 de busboy, igual que el panel', async () => {
    const { controller, attachments } = makeController();
    attachments.upload.mockResolvedValue(makeSummary());
    const comoLoEntregaMulter = Buffer.from('facturación.png', 'utf8').toString('latin1');

    await controller.upload(CLIENTE, 4, 11, makeMulterFile({ originalname: comoLoEntregaMulter }));

    expect(attachments.upload.mock.calls[0][3].filename).toBe('facturación.png');
  });

  it('sin fichero, 400 con `{ code, message }` en español', async () => {
    const { controller, attachments } = makeController();

    const error = (await controller
      .upload(CLIENTE, 4, 11, undefined as any)
      .catch((e: unknown) => e)) as BadRequestException;

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      code: 'BAD_INPUT',
      message: expect.stringContaining('archivo'),
    });
    expect(attachments.upload).not.toHaveBeenCalled();
  });

  it('devuelve el adjunto proyectado: ni `messageId` ni nada que no se publique', async () => {
    const { controller, attachments } = makeController();
    attachments.upload.mockResolvedValue(makeSummary({ id: 100, messageId: 11 }));

    const salida: any = await controller.upload(CLIENTE, 4, 11, makeMulterFile());

    expect(Object.keys(salida)).toEqual(['id', 'filename', 'mimeType', 'size', 'createdAt']);
  });

  it('el traductor de errores de subida va por delante de FileInterceptor', () => {
    const interceptores = Reflect.getMetadata(INTERCEPTORS_METADATA, controllerPrototype.upload);

    expect(interceptores[0]).toBe(AttachmentUploadErrorsInterceptor);
    expect(interceptores).toHaveLength(2);
  });
});

describe('PortalMessagesController.listThread — la proyección', () => {
  it('cada mensaje se compone campo por campo, con sus adjuntos dentro', async () => {
    const { controller, messages, attachments } = makeController();
    messages.listThread.mockResolvedValue([makeMessage({ id: 11 })]);
    attachments.list.mockResolvedValue([makeSummary({ id: 100, messageId: 11 })]);

    const hilo: any = await controller.listThread(CLIENTE, 4);

    expect(Object.keys(hilo[0])).toEqual(['id', 'bodyMd', 'author', 'createdAt', 'attachments']);
    expect(Object.keys(hilo[0].attachments[0])).toEqual([
      'id',
      'filename',
      'mimeType',
      'size',
      'createdAt',
    ]);
    expect(hilo[0].createdAt).toBe('2026-08-06T10:00:00.000Z');
  });

  /**
   * La razón de que la proyección sea campo por campo y no un `spread` menos
   * unas claves: una columna nueva en la entidad no se publica sola.
   */
  it('una columna nueva de la entidad no aparece en la respuesta', async () => {
    const { controller, messages, attachments } = makeController();
    messages.listThread.mockResolvedValue([
      makeMessage({ costeInterno: 1200, notaDeRiesgo: 'no renueva' }),
    ]);
    attachments.list.mockResolvedValue([]);

    const crudo = JSON.stringify(await controller.listThread(CLIENTE, 4));

    expect(crudo).not.toContain('costeInterno');
    expect(crudo).not.toContain('notaDeRiesgo');
    expect(crudo).not.toContain('authorClientUserId');
    expect(crudo).not.toContain('ticketId');
  });

  it('cada adjunto va con su mensaje, y los de un mensaje sin adjuntos no se inventan', async () => {
    const { controller, messages, attachments } = makeController();
    messages.listThread.mockResolvedValue([makeMessage({ id: 11 }), makeMessage({ id: 12 })]);
    attachments.list.mockResolvedValue([
      makeSummary({ id: 100, messageId: 12 }),
      makeSummary({ id: 101, messageId: 12 }),
    ]);

    const hilo: any = await controller.listThread(CLIENTE, 4);

    expect(hilo[0].attachments).toEqual([]);
    expect(hilo[1].attachments.map((a: any) => a.id)).toEqual([100, 101]);
  });

  /**
   * TypeORM hidrata **toda** columna `bigint` como cadena, así que el
   * `messageId` de un adjunto puede llegar como `"12"` y el `id` del mensaje
   * como `12`. Si el emparejamiento dependiera de `===`, el hilo saldría con
   * todos los adjuntos perdidos.
   */
  it('empareja aunque los identificadores lleguen como cadena, que es como los da TypeORM', async () => {
    const { controller, messages, attachments } = makeController();
    messages.listThread.mockResolvedValue([makeMessage({ id: '12' })]);
    attachments.list.mockResolvedValue([makeSummary({ id: '100', messageId: '12' })]);

    const hilo: any = await controller.listThread(CLIENTE, 4);

    expect(hilo[0].id).toBe(12);
    expect(hilo[0].attachments).toHaveLength(1);
    expect(hilo[0].attachments[0].id).toBe(100);
  });

  /**
   * **Quién escribió el mensaje.** Para atribuírselo al equipo hace falta la
   * prueba positiva -- que la fila traiga un autor del equipo --, nunca la
   * ausencia de la del cliente. Una fila sin autor (que el esquema admite y el
   * servicio impide) no puede acabar presentándole al cliente sus propias
   * palabras como una respuesta de Kubo.
   */
  describe('de quién es cada mensaje', () => {
    const casos: Array<[string, Record<string, unknown>, string]> = [
      ['lo escribió el cliente', { authorUserId: null, authorClientUserId: 42 }, 'CLIENT'],
      ['lo escribió el equipo', { authorUserId: 9, authorClientUserId: null }, 'STAFF'],
      ['no tiene autor', { authorUserId: null, authorClientUserId: null }, 'CLIENT'],
      ['tiene los dos', { authorUserId: 9, authorClientUserId: 42 }, 'CLIENT'],
    ];

    it.each(casos)('%s → %s', async (_nombre, columnas, esperado) => {
      const { controller, messages, attachments } = makeController();
      messages.listThread.mockResolvedValue([makeMessage(columnas)]);
      attachments.list.mockResolvedValue([]);

      const hilo: any = await controller.listThread(CLIENTE, 4);

      expect(hilo[0].author).toBe(esperado);
    });

    it('el identificador del autor interno no viaja nunca', async () => {
      const { controller, messages, attachments } = makeController();
      messages.listThread.mockResolvedValue([
        makeMessage({ authorUserId: 987654, authorClientUserId: null }),
      ]);
      attachments.list.mockResolvedValue([]);

      expect(JSON.stringify(await controller.listThread(CLIENTE, 4))).not.toContain('987654');
    });
  });
});

describe('PortalMessagesController.download — la cabecera', () => {
  it('fuerza la descarga y prohíbe el sniffing, también para una imagen', async () => {
    const { controller, attachments } = makeController();
    attachments.download.mockResolvedValue(makeDownload({ mimeType: 'image/png' }));
    const { res, headers } = makeResponse();

    await controller.download(CLIENTE, 3, res as any);

    expect(headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(headers.get('content-disposition')).not.toMatch(/inline/);
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('content-type')).toBe('image/png');
    expect(headers.get('content-length')).toBe('1234');
  });

  it('el `filename=` lleva `headerFilename`, y el nombre real va en la forma codificada', async () => {
    const { controller, attachments } = makeController();
    attachments.download.mockResolvedValue(
      makeDownload({ filename: 'facturación.pdf', headerFilename: 'facturacion.pdf' }),
    );
    const { res, headers } = makeResponse();

    await controller.download(CLIENTE, 3, res as any);

    const disposition = headers.get('content-disposition')!;
    expect(disposition).toContain('filename="facturacion.pdf"');
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent('facturación.pdf')}`);
    // El validador real de Node, que es el que hay debajo de `setHeader`:
    // poner el nombre original en `filename=` reventaba con ERR_INVALID_CHAR.
    expect(() => validateHeaderValue('Content-Disposition', disposition)).not.toThrow();
  });

  it('un nombre no ASCII no revienta la cabecera', async () => {
    const casos = [
      { filename: '文件.pdf', headerFilename: '__.pdf' },
      { filename: 'foto😀.png', headerFilename: 'foto_.png' },
    ];

    for (const caso of casos) {
      const { controller, attachments } = makeController();
      attachments.download.mockResolvedValue(makeDownload(caso));
      const { res, headers } = makeResponse();

      await controller.download(CLIENTE, 3, res as any);

      expect(() =>
        validateHeaderValue('Content-Disposition', headers.get('content-disposition')!),
      ).not.toThrow();
    }
  });

  it('las dos cabeceras de seguridad se escriben antes que el tipo', async () => {
    const { controller, attachments } = makeController();
    attachments.download.mockResolvedValue(makeDownload());
    const { res, setHeader } = makeResponse();

    await controller.download(CLIENTE, 3, res as any);

    expect(setHeader.mock.calls.map(([n]) => n.toLowerCase())).toEqual([
      'content-disposition',
      'x-content-type-options',
      'content-type',
      'content-length',
    ]);
  });

  it('canaliza el fichero entero y cierra el flujo de lectura', async () => {
    const { controller, attachments } = makeController();
    const download = makeDownload();
    attachments.download.mockResolvedValue(download);
    const { res, cuerpo } = makeResponse();

    await controller.download(CLIENTE, 3, res as any);

    expect(cuerpo().toString()).toBe('los bytes del fichero');
    expect(download.stream.destroyed).toBe(true);
  });

  it('el 404 del servicio sale sin haber escrito ninguna cabecera', async () => {
    const { controller, attachments } = makeController();
    const cuerpo = { code: 'NOT_FOUND', message: 'Adjunto no encontrado' };
    attachments.download.mockRejectedValue(new NotFoundException(cuerpo));
    const { res } = makeResponse();

    const error = (await controller
      .download(CLIENTE, 3, res as any)
      .catch((e: unknown) => e)) as NotFoundException;

    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual(cuerpo);
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});

/**
 * **La prueba que de verdad importa**, y la que el pliego pide comprobar sobre
 * el cuerpo serializado y no sobre el tipo: una nota interna no sale por
 * ninguna vía del portal, ni ella ni sus adjuntos, ni en el conteo.
 *
 * Va contra los **servicios de verdad** -- los que tienen la política -- con
 * solo la base falseada: si el hilo del portal se compusiera con un actor mal
 * construido, o alguien apagara el filtro de visibilidad, aquí se vería. Con
 * dobles de los servicios el test solo comprobaría lo que el propio test
 * decidió devolver.
 */
describe('Portal — lo interno no existe (integración HTTP, servicios reales)', () => {
  const CLIENT_ACCESS_SECRET = 'secreto-de-pruebas-del-portal';
  const CONTENIDO = 'los bytes del adjunto público';

  /** Un ticket de la empresa 7; el 5 es de otra empresa. */
  const TICKETS: Record<string, any> = {
    '4': { id: 4, clientId: 7, status: 'EN_ATENCION' },
    '5': { id: 5, clientId: 999, status: 'EN_ATENCION' },
  };

  const MENSAJES: any[] = [
    {
      id: 1,
      ticketId: 4,
      bodyMd: 'No puedo emitir facturas.',
      visibility: 'PUBLICA',
      authorUserId: null,
      authorClientUserId: 42,
      createdAt: new Date('2026-08-06T10:00:00.000Z'),
    },
    {
      id: 2,
      ticketId: 4,
      bodyMd: 'Ya lo estamos mirando.',
      visibility: 'PUBLICA',
      authorUserId: 9,
      authorClientUserId: null,
      createdAt: new Date('2026-08-06T11:00:00.000Z'),
    },
    {
      id: 3,
      ticketId: 4,
      bodyMd: 'NOTA INTERNA: este cliente no paga desde marzo, no priorizar.',
      visibility: 'INTERNA',
      authorUserId: 9,
      authorClientUserId: null,
      createdAt: new Date('2026-08-06T11:30:00.000Z'),
    },
  ];

  const ADJUNTOS: any[] = [
    {
      id: 100,
      ticketId: 4,
      messageId: 1,
      filename: 'facturación.png',
      storageKey: 'tickets/4/aaaa-bbbb.png',
      mimeType: 'image/png',
      sizeBytes: Buffer.byteLength(CONTENIDO),
      uploadedByUserId: null,
      uploadedByClientUserId: 42,
      createdAt: new Date('2026-08-06T10:01:00.000Z'),
    },
    {
      id: 101,
      ticketId: 4,
      messageId: 3,
      filename: 'morosidad-clienteprueba.pdf',
      storageKey: 'tickets/4/cccc-dddd.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      uploadedByUserId: 9,
      uploadedByClientUserId: null,
      createdAt: new Date('2026-08-06T11:31:00.000Z'),
    },
  ];

  /**
   * La base, falseada. `listByTicket` y `listAttachments` reproducen lo que
   * hacen el `WHERE` y el `INNER JOIN` de verdad (que tienen su propio spec):
   * lo que aquí se prueba es que el portal pide **sin** las internas.
   */
  const repositorio = {
    listByTicket: jest.fn(async (ticketId: any, { includeInternal }: any) =>
      MENSAJES.filter(
        (m) =>
          String(m.ticketId) === String(ticketId) &&
          (includeInternal || m.visibility === 'PUBLICA'),
      ),
    ),
    listAttachments: jest.fn(async (ticketId: any, { includeInternal }: any) =>
      ADJUNTOS.filter((a) => {
        if (String(a.ticketId) !== String(ticketId)) return false;
        if (includeInternal) return true;
        const mensaje = MENSAJES.find(
          (m) => String(m.id) === String(a.messageId) && String(m.ticketId) === String(a.ticketId),
        );
        return mensaje?.visibility === 'PUBLICA';
      }),
    ),
    findMessage: jest.fn(async (id: any) => MENSAJES.find((m) => String(m.id) === String(id)) ?? null),
    findAttachment: jest.fn(async (id: any) => ADJUNTOS.find((a) => String(a.id) === String(id)) ?? null),
  };

  const tickets = {
    findById: jest.fn(async (id: any) => TICKETS[String(id)] ?? null),
  };

  const storage = {
    createReadStream: jest.fn(() => Readable.from([Buffer.from(CONTENIDO)])),
  };

  let app: TestHttpApp;

  const tokenDe = (clientId: number, clientUserId = 42) =>
    new JwtService({}).sign(
      { sub: clientUserId, email: 'portal.test@clienteprueba.pe', clientId, isClientAdmin: false },
      { secret: CLIENT_ACCESS_SECRET, expiresIn: '5m' },
    );

  beforeAll(async () => {
    const config = {
      get: (key: string, fallback?: string) =>
        ({ JWT_CLIENT_ACCESS_SECRET: CLIENT_ACCESS_SECRET })[key] ?? fallback,
    };

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [PortalMessagesController],
      providers: [
        { provide: ConfigService, useValue: config },
        ClientJwtStrategy,
        TicketMessagesService,
        TicketAttachmentsService,
        { provide: TicketMessagesRepository, useValue: repositorio },
        { provide: TicketsRepository, useValue: tickets },
        { provide: TicketEventsService, useValue: {} },
        { provide: SlaService, useValue: {} },
        { provide: STORAGE_SERVICE, useValue: storage },
      ],
    }).compile();

    app = await startTestHttpApp(moduleRef);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sin token no se llega al hilo', async () => {
    expect((await app.get('/portal/tickets/4/messages')).status).toBe(401);
  });

  it('la nota interna no aparece en el hilo, ni ella ni su adjunto, ni en el conteo', async () => {
    const res = await app.get('/portal/tickets/4/messages', { token: tokenDe(7) });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    // Sobre el cuerpo **serializado**: lo que de verdad sale por el cable.
    const crudo = JSON.stringify(res.body);
    expect(crudo).not.toContain('NOTA INTERNA');
    expect(crudo).not.toContain('no paga desde marzo');
    expect(crudo).not.toContain('morosidad');
    expect(crudo).not.toContain('INTERNA');
    expect(crudo).not.toContain('visibility');
    expect(crudo).not.toContain('storageKey');
    expect(crudo).not.toContain('tickets/4/');
    expect(crudo).not.toContain('authorUserId');

    // Y el conteo tampoco los incluye.
    const totalAdjuntos = res.body.reduce((n: number, m: any) => n + m.attachments.length, 0);
    expect(totalAdjuntos).toBe(1);
    expect(res.body[0].attachments[0].filename).toBe('facturación.png');
  });

  it('el hilo dice de quién es cada mensaje, y nada más', async () => {
    const res = await app.get('/portal/tickets/4/messages', { token: tokenDe(7) });

    expect(res.body.map((m: any) => m.author)).toEqual(['CLIENT', 'STAFF']);
    expect(res.body[1]).toEqual({
      id: 2,
      bodyMd: 'Ya lo estamos mirando.',
      author: 'STAFF',
      createdAt: '2026-08-06T11:00:00.000Z',
      attachments: [],
    });
  });

  /**
   * `HttpExceptionFilter` añade a todo error el `path` y el `timestamp` de la
   * petición: son distintos por definición --son la petición-- y no distinguen
   * lo que existe de lo que no. Lo que tiene que ser idéntico es todo lo demás.
   */
  const loQueNoDependeDeLaPeticion = ({ path, timestamp, ...resto }: any) => resto;

  it('el hilo de otra empresa da el mismo 404 que uno que no existe', async () => {
    const ajeno = await app.get('/portal/tickets/5/messages', { token: tokenDe(7) });
    const inexistente = await app.get('/portal/tickets/98765/messages', { token: tokenDe(7) });

    expect(ajeno.status).toBe(404);
    expect(ajeno.body).toMatchObject({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
    expect(loQueNoDependeDeLaPeticion(ajeno.body)).toEqual(
      loQueNoDependeDeLaPeticion(inexistente.body),
    );
    expect(ajeno.status).toBe(inexistente.status);
  });

  it('el adjunto de la nota interna da el mismo 404 que uno que no existe', async () => {
    const interno = await app.get('/portal/attachments/101/download', { token: tokenDe(7) });
    const inexistente = await app.get('/portal/attachments/98765/download', { token: tokenDe(7) });

    expect(interno.status).toBe(404);
    expect(interno.body).toMatchObject({ code: 'NOT_FOUND', message: 'Adjunto no encontrado' });
    expect(loQueNoDependeDeLaPeticion(interno.body)).toEqual(
      loQueNoDependeDeLaPeticion(inexistente.body),
    );
    // Y ni una cabecera de fichero: la respuesta es el JSON de error de siempre.
    expect(interno.headers.get('content-disposition')).toBeNull();
  });

  it('el adjunto de otra empresa da el mismo 404, con el mismo cuerpo', async () => {
    const ajeno = await app.get('/portal/attachments/100/download', { token: tokenDe(999) });
    const inexistente = await app.get('/portal/attachments/98765/download', { token: tokenDe(999) });

    expect(ajeno.status).toBe(404);
    expect(ajeno.body).toMatchObject({ code: 'NOT_FOUND', message: 'Adjunto no encontrado' });
    expect(loQueNoDependeDeLaPeticion(ajeno.body)).toEqual(
      loQueNoDependeDeLaPeticion(inexistente.body),
    );
  });

  it('el adjunto público se descarga forzado, con nosniff y el nombre en ASCII', async () => {
    const res = await app.get('/portal/attachments/100/download', { token: tokenDe(7) });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-type')).toBe('image/png');
    // `facturación.png` no cabe en un `filename=`: ahí va el ASCII, y el nombre
    // de verdad viaja detrás en la forma codificada.
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="facturacion.png"; filename*=UTF-8''${encodeURIComponent('facturación.png')}`,
    );
    expect(res.body).toBe(CONTENIDO);
  });

  describe('el cuerpo de la petición no fija nada', () => {
    it('una visibilidad en el cuerpo se rechaza, y la respuesta no dice cuál era', async () => {
      const res = await app.post('/portal/tickets/4/messages', {
        token: tokenDe(7),
        body: { bodyMd: 'hola', visibility: 'INTERNA' },
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('visibility');
      expect(JSON.stringify(res.body)).not.toContain('INTERNA');
    });

    it.each(['clientId', 'clientUserId', 'authorUserId', 'ticketId'])(
      'un %s en el cuerpo se rechaza',
      async (campo) => {
        const res = await app.post('/portal/tickets/4/messages', {
          token: tokenDe(7),
          body: { bodyMd: 'hola', [campo]: 99 },
        });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(res.body)).not.toContain(campo);
      },
    );

    it('un identificador de ticket que no es un número da un error en español', async () => {
      const res = await app.get('/portal/tickets/abc/messages', { token: tokenDe(7) });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message.toLowerCase()).not.toContain('validation failed');
      expect(res.body.message.toLowerCase()).not.toContain('numeric string');
    });
  });
});
