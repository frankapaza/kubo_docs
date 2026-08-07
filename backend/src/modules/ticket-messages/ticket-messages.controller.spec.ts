import { validateHeaderValue } from 'http';

import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { lastValueFrom, throwError } from 'rxjs';

import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { MAX_FILE_BYTES } from './domain/attachment-rules';
import { AttachmentUploadErrorsInterceptor } from './interceptors/attachment-upload-errors.interceptor';
import {
  ATTACHMENT_UPLOAD_LIMITS,
  TicketMessagesController,
} from './ticket-messages.controller';
import { TicketMessagesModule } from './ticket-messages.module';

/** El `DataSource` del que cuelgan todos los repositorios, para no necesitar MySQL. */
const dataSourceFalso = {
  entityMetadatas: [],
  options: { type: 'mysql' },
  getRepository: () => ({}),
};

/** El usuario del token, tal y como lo deja `JwtAuthGuard` en la petición. */
const TECNICO = { id: 7, email: 'tecnico@kubo.pe', role: 'DEVELOPER' };

/** Los métodos del controlador, para leerles los metadatos que dejan los decoradores. */
const controllerPrototype = TicketMessagesController.prototype as unknown as Record<
  string,
  (...args: unknown[]) => unknown
>;

/** Dobles mínimos de los dos servicios: cada método, un `jest.fn` propio. */
function makeController() {
  const messages = {
    post: jest.fn(),
    listThread: jest.fn(),
  };
  const attachments = {
    upload: jest.fn(),
    download: jest.fn(),
    list: jest.fn(),
  };
  const controller = new TicketMessagesController(messages as any, attachments as any);
  return { controller, messages, attachments };
}

/**
 * Un doble de `Response` que se comporta como el de verdad **en lo que
 * importa aquí**: guarda las cabeceras y deja inspeccionarlas. La validación
 * de que el valor es escribible no se simula -- se hace aparte con
 * `http.validateHeaderValue`, que es el mismo validador que hay debajo de
 * `res.setHeader`.
 */
function makeResponse() {
  const headers = new Map<string, string>();
  const res = {
    setHeader: jest.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    }),
    on: jest.fn(),
    destroy: jest.fn(),
  };
  return { res, headers };
}

/** Un flujo de lectura de mentira, solo para comprobar que se canaliza. */
function makeStream() {
  return { pipe: jest.fn(), on: jest.fn(), destroy: jest.fn() };
}

/** Lo que devuelve `TicketAttachmentsService.download`, con los dos nombres. */
function makeDownload(over: Partial<Record<string, unknown>> = {}) {
  return {
    stream: makeStream(),
    filename: 'captura.png',
    headerFilename: 'captura.png',
    mimeType: 'image/png',
    size: 1234,
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

describe('TicketMessagesModule — el grafo se monta de verdad', () => {
  /**
   * Nada de lógica: que el contenedor de Nest resuelva el módulo entero con su
   * controlador dentro. Es el fallo que ni TypeScript ni un test de unidad ven
   * -- se manifiesta al arrancar, y tumba el proceso -- y es el que ocurrió al
   * escribir esta tarea: el filtro de multer pasó a tener un parámetro en el
   * constructor y `@UseFilters(MulterExceptionFilter)` dejó al contenedor
   * buscando un proveedor de `Number`.
   *
   * El `useMocker` sustituye **solo** el `DataSource` -- del que cuelgan todos
   * los repositorios -- y deja que todo lo demás se resuelva de verdad. Un
   * catch-all que devolviera `{}` para cualquier token le habría dado también
   * el `Number` que faltaba, y el test habría pasado con el backend muerto.
   */
  it('compila con el controlador dentro', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), TicketMessagesModule],
    })
      .useMocker((token) => (token === getDataSourceToken() ? dataSourceFalso : undefined))
      .compile();

    expect(moduleRef.get(TicketMessagesController)).toBeInstanceOf(TicketMessagesController);
    await moduleRef.close();
  });
});

describe('TicketMessagesController — guards', () => {
  it('lleva JwtAuthGuard, StaffOnlyGuard y RolesGuard, en ese orden, como el resto del panel', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, TicketMessagesController);

    expect(guards).toEqual([JwtAuthGuard, StaffOnlyGuard, RolesGuard]);
  });

  it('ninguna ruta exige un rol concreto: escribir en el hilo y adjuntar lo hace cualquiera del equipo', () => {
    // `RolesGuard` está montado para que un `@Roles` futuro funcione, pero hoy
    // no hay ninguno: el hilo de un ticket es trabajo de soporte, no de
    // administración, y un DEVELOPER que no pueda responder a su propio ticket
    // no tendría sentido. Si alguien añade un `@Roles` aquí, este test le
    // obliga a justificarlo.
    const rutas = ['listThread', 'post', 'listAttachments', 'upload', 'download'];

    expect(Reflect.getMetadata(ROLES_KEY, TicketMessagesController)).toBeUndefined();
    for (const ruta of rutas) {
      expect(Reflect.getMetadata(ROLES_KEY, controllerPrototype[ruta])).toBeUndefined();
    }
  });
});

describe('TicketMessagesController — el actor', () => {
  it('el hilo se escribe siempre con un actor del equipo sacado del token', async () => {
    const { controller, messages } = makeController();
    messages.post.mockResolvedValue({ message: { id: 1 }, ticket: { id: 4 } });

    await controller.post(TECNICO, 4, { bodyMd: 'hola' });

    expect(messages.post).toHaveBeenCalledWith({ kind: 'STAFF', userId: 7 }, 4, {
      bodyMd: 'hola',
      visibility: undefined,
    });
  });

  it('la visibilidad se pasa tal cual al servicio: el controlador no la decide', async () => {
    const { controller, messages } = makeController();
    messages.post.mockResolvedValue({ message: { id: 1 }, ticket: { id: 4 } });

    await controller.post(TECNICO, 4, { bodyMd: 'nota', visibility: 'INTERNA' });

    expect(messages.post).toHaveBeenCalledWith({ kind: 'STAFF', userId: 7 }, 4, {
      bodyMd: 'nota',
      visibility: 'INTERNA',
    });
  });

  it('devuelve lo que devuelve el servicio, sin recortarlo ni reinterpretarlo', async () => {
    const { controller, messages } = makeController();
    const posted = { message: { id: 11, visibility: 'INTERNA' }, ticket: { id: 4 } };
    messages.post.mockResolvedValue(posted);

    await expect(controller.post(TECNICO, 4, { bodyMd: 'nota' })).resolves.toBe(posted);
  });

  it('leer el hilo también va con actor del equipo, y devuelve la lista tal cual', async () => {
    const { controller, messages } = makeController();
    const hilo = [{ id: 1 }, { id: 2 }];
    messages.listThread.mockResolvedValue(hilo);

    await expect(controller.listThread(TECNICO, 4)).resolves.toBe(hilo);
    expect(messages.listThread).toHaveBeenCalledWith({ kind: 'STAFF', userId: 7 }, 4);
  });

  it('listar adjuntos va con actor del equipo', async () => {
    const { controller, attachments } = makeController();
    attachments.list.mockResolvedValue([]);

    await controller.listAttachments(TECNICO, 4);

    expect(attachments.list).toHaveBeenCalledWith({ kind: 'STAFF', userId: 7 }, 4);
  });

  it('el actor sale del token de cada petición, no de un valor fijo', async () => {
    const { controller, messages } = makeController();
    messages.listThread.mockResolvedValue([]);

    await controller.listThread({ id: 99, email: 'otra@kubo.pe', role: 'ADMIN' }, 4);

    expect(messages.listThread).toHaveBeenCalledWith({ kind: 'STAFF', userId: 99 }, 4);
  });
});

describe('TicketMessagesController.upload', () => {
  it('cuelga el adjunto del mensaje de la ruta y le pasa el fichero al servicio', async () => {
    const { controller, attachments } = makeController();
    attachments.upload.mockResolvedValue({ id: 3 });
    const file = makeMulterFile({ originalname: 'factura.pdf', mimetype: 'application/pdf' });

    await controller.upload(TECNICO, 4, 11, file);

    expect(attachments.upload).toHaveBeenCalledWith({ kind: 'STAFF', userId: 7 }, 4, 11, {
      buffer: file.buffer,
      declaredMime: 'application/pdf',
      filename: 'factura.pdf',
      declaredSize: file.size,
    });
  });

  it('sin fichero, 400 con `{ code, message }` en español -- no un 500 dentro del servicio', async () => {
    const { controller, attachments } = makeController();

    await expect(controller.upload(TECNICO, 4, 11, undefined as any)).rejects.toThrow(
      BadRequestException,
    );
    expect(attachments.upload).not.toHaveBeenCalled();

    const error = (await controller
      .upload(TECNICO, 4, 11, undefined as any)
      .catch((e: unknown) => e)) as BadRequestException;
    expect(error.getResponse()).toEqual({
      code: 'BAD_INPUT',
      message: expect.stringContaining('archivo'),
    });
  });

  it('el límite de multer es el mismo tope por fichero que aplica el dominio', () => {
    // La primera criba, para no tragarse en memoria un fichero enorme. No
    // sustituye a `assertAcceptable`, que sigue midiendo `buffer.length`: si
    // este límite y el del dominio divergieran, uno de los dos mentiría.
    expect(ATTACHMENT_UPLOAD_LIMITS.fileSize).toBe(MAX_FILE_BYTES);
  });

  /**
   * Lo que multer entrega en `originalname` **no es** lo que mandó el
   * navegador: busboy decodifica el `filename=` del multipart como latin1
   * (multer 1.4.5 no le pasa `defParamCharset` y no hay forma de configurarlo
   * desde fuera), así que un nombre UTF-8 llega hecho mojibake. Comprobado
   * contra el backend real: `facturación.png` se guardaba como
   * `facturaciÃ³n.png` y `文件.png` como `æ–‡ä»¶.png`.
   *
   * Los casos se construyen aplicando la misma transformación que hace busboy,
   * no copiando a mano una cadena rota: así el test dice **por qué** llega así.
   */
  const comoLoEntregaMulter = (nombre: string) =>
    Buffer.from(nombre, 'utf8').toString('latin1');

  describe('el nombre del fichero se rescata del latin1 de busboy', () => {
    it.each([['facturación.png'], ['文件.png'], ['foto😀.png'], ['informe año 2026.pdf']])(
      '%s sobrevive al viaje',
      async (nombre) => {
        const { controller, attachments } = makeController();
        attachments.upload.mockResolvedValue({ id: 3 });

        await controller.upload(
          TECNICO,
          4,
          11,
          makeMulterFile({ originalname: comoLoEntregaMulter(nombre) }),
        );

        expect(attachments.upload.mock.calls[0][3].filename).toBe(nombre);
      },
    );

    it('un nombre ASCII no se toca', async () => {
      const { controller, attachments } = makeController();
      attachments.upload.mockResolvedValue({ id: 3 });

      await controller.upload(TECNICO, 4, 11, makeMulterFile({ originalname: 'captura.png' }));

      expect(attachments.upload.mock.calls[0][3].filename).toBe('captura.png');
    });

    /**
     * **La colisión, documentada y aceptada.**
     *
     * Un fichero que de verdad se llame `Ã©.png` sale de aquí llamándose
     * `é.png`. No es un descuido ni algo que se pueda arreglar: busboy entrega
     * **los mismos bytes** para `Ã©.png` enviado en latin1 que para `é.png`
     * enviado en UTF-8, así que no hay ninguna información con la que
     * distinguirlos. Hay que elegir, y se elige el caso que ocurre: todo
     * navegador actual manda UTF-8, y `é.png` es un nombre que la gente pone
     * mientras que `Ã©.png` es lo que sale de un fallo de codificación.
     *
     * Existe este test para que quien se lo encuentre sepa que se miró y se
     * decidió, y no lo tome por un fallo: sin él, la suite solo cubre el lado
     * cómodo y el hallazgo parece nuevo.
     *
     * Que el error caiga de este lado tampoco cuesta nada real: el nombre es un
     * dato decorativo. No participa en la clave de almacenamiento, ni en la
     * detección del tipo, ni en ninguna decisión de visibilidad.
     */
    it('«Ã©.png» de verdad se colapsa a «é.png»: ambigüedad irreducible, aceptada', async () => {
      const { controller, attachments } = makeController();
      attachments.upload.mockResolvedValue({ id: 3 });

      // Los dos casos llegan a multer **exactamente iguales**, y esa es la
      // razón de la colisión.
      expect(comoLoEntregaMulter('é.png')).toBe('Ã©.png');

      await controller.upload(TECNICO, 4, 11, makeMulterFile({ originalname: 'Ã©.png' }));

      expect(attachments.upload.mock.calls[0][3].filename).toBe('é.png');
    });

    it('un nombre que de verdad era latin1 se deja como está, no se destroza', async () => {
      // `café.png` con la `é` en un solo byte (0xE9) no es UTF-8 válido:
      // reinterpretarlo metería un U+FFFD y dejaría el nombre peor que antes.
      // La reinterpretación solo se aplica si los bytes vuelven idénticos.
      const { controller, attachments } = makeController();
      attachments.upload.mockResolvedValue({ id: 3 });

      await controller.upload(TECNICO, 4, 11, makeMulterFile({ originalname: 'café.png' }));

      const enviado = attachments.upload.mock.calls[0][3].filename;
      expect(enviado).toBe('café.png');
      expect(enviado).not.toContain('�');
    });
  });

  it('el traductor de errores de subida va por delante de FileInterceptor', () => {
    // Si fuera al revés, su `next.handle()` no envolvería la subida y no vería
    // nunca el error que la subida produce.
    const interceptores = Reflect.getMetadata(INTERCEPTORS_METADATA, controllerPrototype.upload);

    expect(interceptores[0]).toBe(AttachmentUploadErrorsInterceptor);
    expect(interceptores).toHaveLength(2);
  });
});

/**
 * Lo que `@nestjs/platform-express` produce cuando multer corta la subida: un
 * `HttpException` ya traducido (`multer/multer/multer.utils.js`), con un texto
 * suelto en inglés y **sin** `code`. Es lo que llega de verdad -- comprobado
 * contra el backend real, que contestaba «File too large» --, y por eso el
 * `@Catch(MulterError)` de `audio/filters` no se dispara nunca.
 */
describe('AttachmentUploadErrorsInterceptor', () => {
  const interceptor = new AttachmentUploadErrorsInterceptor();

  /** Hace pasar `error` por el interceptor y devuelve lo que sale por el otro lado. */
  async function atraviesa(error: unknown): Promise<unknown> {
    const next = { handle: () => throwError(() => error) };
    return lastValueFrom(interceptor.intercept({} as any, next as any)).then(
      () => new Error('no lanzó'),
      (e: unknown) => e,
    );
  }

  it('el corte por tamaño sale en español, con el mismo tope que aplica el dominio', async () => {
    const salida = (await atraviesa(
      new PayloadTooLargeException('File too large'),
    )) as PayloadTooLargeException;

    expect(salida).toBeInstanceOf(PayloadTooLargeException);
    expect(salida.getResponse()).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: expect.stringContaining(`${MAX_FILE_BYTES / (1024 * 1024)} MB`),
    });
    expect(JSON.stringify(salida.getResponse())).not.toContain('File too large');
  });

  it('un multipart ilegible también sale con `{ code, message }` en español', async () => {
    const salida = (await atraviesa(
      new BadRequestException('Unexpected field'),
    )) as BadRequestException;

    expect(salida.getResponse()).toEqual({
      code: 'UPLOAD_ERROR',
      message: expect.stringContaining('archivo'),
    });
  });

  it('no toca lo que ya trae `code`: el 413 del presupuesto del ticket llega intacto', async () => {
    // El dominio también lanza `PayloadTooLargeException`, y su mensaje dice
    // qué hacer. Reescribirlo aquí lo borraría.
    const delDominio = new PayloadTooLargeException({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Este ticket ya ha alcanzado el máximo de 100 MB en archivos adjuntos.',
    });

    await expect(atraviesa(delDominio)).resolves.toBe(delDominio);
  });

  it('no toca el 404 ni el 415 del servicio', async () => {
    const noEncontrado = new NotFoundException({ code: 'NOT_FOUND', message: 'Mensaje no encontrado' });
    const tipoMalo = new UnsupportedMediaTypeException({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'El archivo no es de un tipo permitido.',
    });

    await expect(atraviesa(noEncontrado)).resolves.toBe(noEncontrado);
    await expect(atraviesa(tipoMalo)).resolves.toBe(tipoMalo);
  });

  it('un fallo que no es una HttpException pasa tal cual: no se disfraza de error de subida', async () => {
    const roto = new Error('ECONNRESET');

    await expect(atraviesa(roto)).resolves.toBe(roto);
  });
});

describe('TicketMessagesController.download — la cabecera', () => {
  it('fuerza la descarga y prohíbe el sniffing, también para una imagen', async () => {
    const { controller, attachments } = makeController();
    attachments.download.mockResolvedValue(makeDownload({ mimeType: 'image/png' }));
    const { res, headers } = makeResponse();

    await controller.download(TECNICO, 3, res as any);

    // Un PNG que además es HTML válido es un fichero real y posible: la firma
    // de bytes lo ve como PNG y no hay antivirus detrás. Estas dos cabeceras
    // son la barrera que lo cubre, y por eso no dependen del tipo.
    expect(headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(headers.get('content-disposition')).not.toMatch(/inline/);
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sirve el tipo detectado en la subida, no uno inventado por el controlador', async () => {
    const { controller, attachments } = makeController();
    attachments.download.mockResolvedValue(makeDownload({ mimeType: 'application/pdf', size: 88 }));
    const { res, headers } = makeResponse();

    await controller.download(TECNICO, 3, res as any);

    expect(headers.get('content-type')).toBe('application/pdf');
    expect(headers.get('content-length')).toBe('88');
  });

  it('el `filename=` de la cabecera es `headerFilename`, nunca `filename`', async () => {
    const { controller, attachments } = makeController();
    attachments.download.mockResolvedValue(
      makeDownload({ filename: 'facturación.pdf', headerFilename: 'facturacion.pdf' }),
    );
    const { res, headers } = makeResponse();

    await controller.download(TECNICO, 3, res as any);

    expect(headers.get('content-disposition')).toContain('filename="facturacion.pdf"');
  });

  it('un nombre no ASCII no revienta la cabecera: el valor pasa el validador real de Node', async () => {
    // Esto es lo que reventaba antes con `ERR_INVALID_CHAR` en cuanto el
    // controlador escribía la cabecera: un 500 provocable subiendo un fichero
    // con un nombre perfectamente legítimo.
    const casos = [
      { filename: '文件.pdf', headerFilename: '__.pdf' },
      { filename: 'foto😀.png', headerFilename: 'foto_.png' },
      { filename: 'facturación.pdf', headerFilename: 'facturacion.pdf' },
    ];

    for (const caso of casos) {
      const { controller, attachments } = makeController();
      attachments.download.mockResolvedValue(makeDownload(caso));
      const { res, headers } = makeResponse();

      await controller.download(TECNICO, 3, res as any);

      const disposition = headers.get('content-disposition')!;
      expect(() => validateHeaderValue('Content-Disposition', disposition)).not.toThrow();
    }
  });

  it('añade la forma RFC 5987 con el nombre real, percent-encoded', async () => {
    const { controller, attachments } = makeController();
    attachments.download.mockResolvedValue(
      makeDownload({ filename: 'facturación.pdf', headerFilename: 'facturacion.pdf' }),
    );
    const { res, headers } = makeResponse();

    await controller.download(TECNICO, 3, res as any);

    expect(headers.get('content-disposition')).toContain(
      `filename*=UTF-8''${encodeURIComponent('facturación.pdf')}`,
    );
  });

  it('la forma codificada escapa también lo que `encodeURIComponent` deja pasar', async () => {
    // `!`, `(`, `)`, `*` y `'` no son `attr-char` (RFC 5987) y
    // `encodeURIComponent` no los toca. `sanitizeFilename` ya quita `'` y `*`,
    // pero la cabecera no debe depender de eso.
    const { controller, attachments } = makeController();
    attachments.download.mockResolvedValue(
      makeDownload({ filename: "captura (1)!.png", headerFilename: 'captura (1)!.png' }),
    );
    const { res, headers } = makeResponse();

    await controller.download(TECNICO, 3, res as any);

    const codificado = headers.get('content-disposition')!.split("filename*=UTF-8''")[1];
    expect(codificado).not.toMatch(/[()!'*]/);
    expect(decodeURIComponent(codificado)).toBe('captura (1)!.png');
  });

  it('canaliza el flujo del servicio hacia la respuesta', async () => {
    const { controller, attachments } = makeController();
    const download = makeDownload();
    attachments.download.mockResolvedValue(download);
    const { res } = makeResponse();

    await controller.download(TECNICO, 3, res as any);

    expect(download.stream.pipe).toHaveBeenCalledWith(res);
    expect(attachments.download).toHaveBeenCalledWith({ kind: 'STAFF', userId: 7 }, 3);
  });

  it('las dos cabeceras de seguridad se escriben antes que el tipo', async () => {
    // Si componer el nombre llegara a lanzar, lo ya escrito tiene que obligar a
    // descargar. Al revés, el filtro global serviría su JSON de error encima de
    // un `Content-Type: image/png` sin `nosniff`. Hoy es inalcanzable --el
    // servicio garantiza ASCII-- y por eso mismo el orden no puede apoyarse en
    // esa garantía.
    const { controller, attachments } = makeController();
    attachments.download.mockResolvedValue(makeDownload());
    const { res } = makeResponse();

    await controller.download(TECNICO, 3, res as any);

    const escritas = res.setHeader.mock.calls.map(([nombre]) => nombre.toLowerCase());
    expect(escritas.indexOf('content-disposition')).toBeLessThan(escritas.indexOf('content-type'));
    expect(escritas.indexOf('x-content-type-options')).toBeLessThan(
      escritas.indexOf('content-type'),
    );
  });

  it('corta la conexión si el flujo falla, sobre el oyente que ya trae del servicio', async () => {
    // Con las cabeceras enviadas no cabe un JSON de error. Lo que impide que un
    // `ENOENT` mate el proceso **no** es este oyente sino el que pone
    // `TicketAttachmentsService.openOrFail` al crear el flujo: ahí hay un test
    // que lo sujeta. Este solo añade lo que este lado puede hacer.
    const { controller, attachments } = makeController();
    const download = makeDownload();
    attachments.download.mockResolvedValue(download);
    const { res } = makeResponse();

    await controller.download(TECNICO, 3, res as any);

    const oyente = download.stream.on.mock.calls.find(([evento]: [string]) => evento === 'error');
    expect(oyente).toBeDefined();
    const causa = new Error('ENOENT');
    expect(() => oyente[1](causa)).not.toThrow();
    expect(res.destroy).toHaveBeenCalledWith(causa);
  });

  it('el 404 del servicio sale sin haber escrito ninguna cabecera', async () => {
    // Con la excepción de verdad, no un `Error` pelado: `rejects.toThrow()` sin
    // argumento pasa con cualquier cosa, y lo que aquí importa es que el 404
    // del servicio llega entero al filtro global -- con su `{ code, message }`
    // y su estado -- y no convertido en un 500 por el camino.
    const { controller, attachments } = makeController();
    const cuerpo = { code: 'NOT_FOUND', message: 'Adjunto no encontrado' };
    attachments.download.mockRejectedValue(new NotFoundException(cuerpo));
    const { res } = makeResponse();

    const error = (await controller
      .download(TECNICO, 3, res as any)
      .catch((e: unknown) => e)) as NotFoundException;

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual(cuerpo);
    // Y ni una cabecera escrita: el filtro global puede componer su respuesta
    // desde cero, sin un `Content-Type: image/png` heredado debajo.
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
