import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

import { AttachmentCandidate, MAX_FILE_BYTES, MAX_TICKET_BYTES } from './domain/attachment-rules';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketAttachment } from './entities/ticket-attachment.entity';
import { TicketMessage } from './entities/ticket-message.entity';
import { TicketAttachmentsService } from './ticket-attachments.service';

/** La empresa dueña de los tickets de estos tests. */
const EMPRESA = 3;
const OTRA_EMPRESA = 99;

const CLIENTE = { kind: 'CLIENT', clientUserId: 11, clientId: EMPRESA } as const;
const EQUIPO = { kind: 'STAFF', userId: 5 } as const;

/** El mensaje del que cuelga todo adjunto: ya no hay adjuntos sin mensaje. */
const MENSAJE = 501;

/**
 * Los tres cuerpos de 404, uno por sujeto preguntado. Dentro de cada sujeto el
 * cuerpo es **idéntico** pase lo que pase -- que no exista, que sea de otra
 * empresa o que cuelgue de una nota interna --, porque cualquier diferencia
 * entre ellos deja distinguir lo que existe de lo que no y enumerar a base de
 * probar números (spec §4, regla 2).
 */
const CUERPO_404_TICKET = { code: 'NOT_FOUND', message: 'Ticket no encontrado' };
const CUERPO_404_MENSAJE = { code: 'NOT_FOUND', message: 'Mensaje no encontrado' };
const CUERPO_404_ADJUNTO = { code: 'NOT_FOUND', message: 'Adjunto no encontrado' };

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Un PNG de verdad por los bytes, del tamaño total que se pida. */
const png = (total = 1024): Buffer =>
  Buffer.concat([Buffer.from(PNG_MAGIC), Buffer.alloc(Math.max(0, total - PNG_MAGIC.length), 0x2a)]);

const pdf = (): Buffer => Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'latin1');

/** La trampa clásica de toda lista de «imágenes»: XML con `<script>` dentro. */
const svg = (): Buffer =>
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');

const ticketRow = (over: Partial<Ticket> = {}): Ticket =>
  ({ id: 7, clientId: EMPRESA, status: 'EN_ATENCION', ...over }) as Ticket;

const messageRow = (over: Partial<TicketMessage> = {}): TicketMessage =>
  ({ id: MENSAJE, ticketId: 7, visibility: 'PUBLICA', ...over }) as TicketMessage;

const attachmentRow = (over: Partial<TicketAttachment> = {}): TicketAttachment =>
  ({
    id: 77,
    ticketId: 7,
    messageId: MENSAJE,
    filename: 'captura.png',
    storageKey: 'tickets/7/9f2c-uuid.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    uploadedByUserId: null,
    uploadedByClientUserId: 11,
    createdAt: new Date('2026-08-06T10:00:00.000Z'),
    ...over,
  }) as TicketAttachment;

/** Lo que llega del multipart. Nada de esto es de fiar salvo `buffer`. */
const archivo = (over: Partial<AttachmentCandidate> = {}): AttachmentCandidate => ({
  buffer: png(1024),
  declaredMime: 'image/png',
  filename: 'captura.png',
  declaredSize: 1024,
  ...over,
});

/**
 * Los dobles imitan el disco y la tabla **con estado**: `escritos` es el
 * directorio de subidas y `filas` la tabla. Así los tests del reparto entre
 * disco y fila no comprueban que se llamó a un método, sino qué quedó al final
 * -- que es la única forma de ver un archivo huérfano o una fila sin archivo.
 */
const makeHarness = (
  opciones: {
    ticket?: Ticket | null;
    mensaje?: TicketMessage | null;
    adjunto?: TicketAttachment | null;
    adjuntos?: TicketAttachment[];
    /** Bytes que los adjuntos de origen cliente ya ocupan en el ticket. */
    bytesDeCliente?: number;
    fallaEn?: 'disco' | 'fila';
    /** El borrado de compensación tampoco puede completarse. */
    fallaElBorrado?: boolean;
  } = {},
) => {
  const ticket = opciones.ticket === undefined ? ticketRow() : opciones.ticket;
  const mensaje = opciones.mensaje === undefined ? messageRow() : opciones.mensaje;

  /** El «directorio de subidas»: clave -> contenido. */
  const escritos = new Map<string, Buffer>();
  /** Las filas de `ticket_attachments` que quedaron confirmadas. */
  const filas: Partial<TicketAttachment>[] = [];
  /** El orden real de las operaciones con efecto, para comprobar el reparto. */
  const orden: string[] = [];

  const streamFalso = { falso: true } as unknown as NodeJS.ReadableStream;

  const tickets = { findById: jest.fn().mockResolvedValue(ticket) };

  const messages = {
    findMessage: jest.fn().mockResolvedValue(mensaje),
    findAttachment: jest.fn().mockResolvedValue(opciones.adjunto ?? null),
    listAttachments: jest.fn().mockResolvedValue(opciones.adjuntos ?? []),
    sumClientBytes: jest.fn().mockResolvedValue(opciones.bytesDeCliente ?? 0),
    createAttachment: jest.fn().mockImplementation((data: Partial<TicketAttachment>) => {
      orden.push('fila');
      if (opciones.fallaEn === 'fila') {
        return Promise.reject(new Error('ER_DUP_ENTRY: storage_key duplicada'));
      }
      filas.push(data);
      return Promise.resolve({ id: 77, createdAt: new Date('2026-08-06T10:00:00.000Z'), ...data });
    }),
  };

  const storage = {
    save: jest.fn().mockImplementation((buffer: Buffer, key: string) => {
      orden.push('disco');
      if (opciones.fallaEn === 'disco') return Promise.reject(new Error('ENOSPC: no queda sitio'));
      escritos.set(key, buffer);
      return Promise.resolve({ key, size: buffer.length });
    }),
    remove: jest.fn().mockImplementation((key: string) => {
      orden.push('borrado');
      if (opciones.fallaElBorrado) return Promise.reject(new Error('EPERM'));
      escritos.delete(key);
      return Promise.resolve();
    }),
    createReadStream: jest.fn().mockReturnValue(streamFalso),
    getPath: jest.fn(),
    saveFromPath: jest.fn(),
  };

  return {
    service: new TicketAttachmentsService(tickets as any, messages as any, storage as any),
    tickets,
    messages,
    storage,
    escritos,
    filas,
    orden,
    streamFalso,
  };
};

afterEach(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------
// Regla 2 del diseño: se valida antes de escribir nada.
// ---------------------------------------------------------------------------

describe('upload: lo que no pasa la aduana no llega al disco', () => {
  /**
   * El test que sostiene la renuncia al antivirus. Si algo no permitido llega a
   * `IStorageService.save`, ya está en el servidor: no hay ninguna otra capa
   * detrás quitándolo.
   */
  it('un SVG no llega a IStorageService.save ni deja fila', async () => {
    const { service, storage, messages, escritos, filas } = makeHarness();

    const error = await service
      .upload(
        CLIENTE,
        7,
        MENSAJE,
        archivo({ buffer: svg(), filename: 'logo.svg', declaredMime: 'image/svg+xml' }),
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(UnsupportedMediaTypeException);
    expect(storage.save).not.toHaveBeenCalled();
    expect(messages.createAttachment).not.toHaveBeenCalled();
    expect(escritos.size).toBe(0);
    expect(filas).toHaveLength(0);
  });

  it('un ejecutable disfrazado de PNG por nombre y tipo declarado tampoco llega', async () => {
    const { service, storage, escritos } = makeHarness();

    await expect(
      service.upload(
        CLIENTE,
        7,
        MENSAJE,
        archivo({ buffer: Buffer.from('MZ\x90\x00ejecutable', 'latin1'), filename: 'captura.png' }),
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

    expect(storage.save).not.toHaveBeenCalled();
    expect(escritos.size).toBe(0);
  });

  it('un archivo por encima del tope por archivo no llega al disco', async () => {
    const { service, storage, messages } = makeHarness();

    await expect(
      service.upload(EQUIPO, 7, MENSAJE, archivo({ buffer: png(MAX_FILE_BYTES + 1) })),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);

    expect(storage.save).not.toHaveBeenCalled();
    expect(messages.createAttachment).not.toHaveBeenCalled();
  });

  it('el tamaño que se guarda es el real del buffer, no el declarado', async () => {
    const { service, filas } = makeHarness();

    await service.upload(EQUIPO, 7, MENSAJE, archivo({ buffer: png(2048), declaredSize: 12 }));

    expect(filas[0].sizeBytes).toBe(2048);
  });

  it('el tipo que se guarda es el detectado por firma, no el declarado', async () => {
    const { service, filas } = makeHarness();

    // Nombre y tipo declarado de imagen; por dentro, un PDF. Los dos los pone
    // quien sube: manda lo que dicen los bytes.
    await service.upload(EQUIPO, 7, MENSAJE, archivo({ buffer: pdf(), filename: 'captura.png' }));

    expect(filas[0].mimeType).toBe('application/pdf');
  });
});

// ---------------------------------------------------------------------------
// El nombre que manda quien sube: acotado y saneado antes de decidir nada.
// ---------------------------------------------------------------------------

describe('upload: el nombre que manda quien sube', () => {
  /**
   * `filename` es `VARCHAR(255)`. Sin cota, un nombre de 300 caracteres se
   * escribía en disco, MySQL rechazaba el `INSERT` en modo estricto, se
   * compensaba con un borrado y salía un **500** por algo que es un 400 -- con
   * una escritura y un borrado de disco por intento, que es una forma barata de
   * hacer trabajar al disco en bucle.
   */
  it('un nombre más largo que la columna se rechaza limpio, sin tocar el disco', async () => {
    const { service, storage, messages } = makeHarness();

    const error = await service
      .upload(CLIENTE, 7, MENSAJE, archivo({ filename: `${'n'.repeat(300)}.png` }))
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse().code).toBe('BAD_INPUT');
    expect(storage.save).not.toHaveBeenCalled();
    expect(messages.createAttachment).not.toHaveBeenCalled();
  });

  it('un nombre de exactamente el largo de la columna sí entra', async () => {
    const { service, filas } = makeHarness();

    const nombre = `${'n'.repeat(251)}.png`;
    await service.upload(CLIENTE, 7, MENSAJE, archivo({ filename: nombre }));

    expect(filas[0].filename).toBe(nombre);
  });

  /**
   * Este nombre acaba en la cabecera `Content-Disposition` del controlador de
   * descarga. Un salto de línea ahí es inyección de cabecera, y unas comillas o
   * un punto y coma, confusión de la disposición. «Sanearlo es cosa de quien lo
   * pinta» vale para HTML, no para una cabecera: quien la escriba tiene que
   * poder hacerlo sin pensar.
   */
  it('despoja los caracteres de control y los que no valen en un nombre de archivo', async () => {
    const { service, filas } = makeHarness();

    await service.upload(
      CLIENTE,
      7,
      MENSAJE,
      archivo({ filename: 'foto";\r\nX-Inyectada: si.png' }),
    );

    const guardado = filas[0].filename as string;
    // Ni control, ni comillas, ni separadores, ni nada de lo que confunde una
    // cabecera o una ruta.
    expect(guardado).not.toMatch(/[\u0000-\u001f\u007f"'`\\\/:;*?<>|]/);
    expect(guardado).toContain('.png');
  });

  /** Spec §7: «Un nombre con `../` no escribe fuera del directorio». */
  it('un nombre con ../ queda sin separadores y sin punto inicial', async () => {
    const { service, filas } = makeHarness();

    await service.upload(EQUIPO, 7, MENSAJE, archivo({ filename: '../../etc/passwd' }));

    expect(filas[0].filename).toBe('_.._etc_passwd');
  });

  it('un nombre que se queda en nada cae en un rótulo genérico, no en una fila vacía', async () => {
    const { service, filas } = makeHarness();

    await service.upload(CLIENTE, 7, MENSAJE, archivo({ filename: '   ...   ' }));

    expect(filas[0].filename).toBe('archivo');
  });
});

// ---------------------------------------------------------------------------
// Regla 1 del diseño: la clave la genera el servidor.
// ---------------------------------------------------------------------------

describe('upload: la clave de almacenamiento', () => {
  it('no contiene el nombre original', async () => {
    const { service, storage, filas } = makeHarness();

    await service.upload(EQUIPO, 7, MENSAJE, archivo({ filename: 'nomina-confidencial.png' }));

    const clave = storage.save.mock.calls[0][1] as string;
    expect(clave).not.toContain('nomina-confidencial');
    expect(filas[0].storageKey).toBe(clave);
  });

  /**
   * Aquí no se comprueba la contención (esa es la segunda red,
   * `LocalStorageService.getPath`) sino la primera: el nombre **no participa**
   * en la clave, así que no hay ni `..` que contener.
   */
  it('un nombre con ../ no se cuela en la clave', async () => {
    const { service, storage } = makeHarness();

    await service.upload(EQUIPO, 7, MENSAJE, archivo({ filename: '../../etc/passwd' }));

    const clave = storage.save.mock.calls[0][1] as string;
    expect(clave).not.toContain('..');
    expect(clave).not.toContain('passwd');
  });

  it('va agrupada por ticket', async () => {
    const { service, storage } = makeHarness({
      ticket: ticketRow({ id: 42 }),
      mensaje: messageRow({ ticketId: 42 }),
    });

    await service.upload(EQUIPO, 42, MENSAJE, archivo());

    expect(storage.save.mock.calls[0][1]).toMatch(/^tickets\/42\//);
  });

  it('no es adivinable: dos subidas del mismo archivo dan claves distintas', async () => {
    const primera = makeHarness();
    const segunda = makeHarness();

    await primera.service.upload(EQUIPO, 7, MENSAJE, archivo());
    await segunda.service.upload(EQUIPO, 7, MENSAJE, archivo());

    const claveA = primera.storage.save.mock.calls[0][1] as string;
    const claveB = segunda.storage.save.mock.calls[0][1] as string;
    expect(claveA).not.toBe(claveB);
    // Y con entropía de sobra: un UUID, no un contador ni una marca de tiempo.
    expect(claveA).toMatch(
      /^tickets\/7\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/,
    );
  });

  it('la extensión sale del tipo detectado, nunca de la del nombre', async () => {
    const { service, storage } = makeHarness();

    await service.upload(EQUIPO, 7, MENSAJE, archivo({ buffer: pdf(), filename: 'factura.png.exe' }));

    expect(storage.save.mock.calls[0][1]).toMatch(/\.pdf$/);
  });

  /**
   * El único tramo de la clave que no es un UUID es el id del ticket. Sale de
   * la fila ya leída --lo devolvió la propia base--, pero afirmar «la clave la
   * genera el servidor» exige que ningún carácter de ella venga de fuera.
   *
   * Y no basta con las comprobaciones que ya hay delante: `sameId` compara por
   * **valor numérico**, así que da por bueno todo lo que `Number()` sepa leer
   * --`'0x7'`, `'7e0'`, `' 7 '`, `'7.0'`--, formas que valen para comparar y no
   * valen como tramo de una ruta. Las dos comprobaciones no son redundantes:
   * esta es la que dice que lo que va a la ruta son dígitos y nada más.
   */
  it('un id de ticket que sameId acepta pero no son dígitos no compone ninguna clave', async () => {
    const { service, storage, messages } = makeHarness({
      ticket: ticketRow({ id: '0x7' as unknown as number }),
      mensaje: messageRow({ ticketId: 7 }),
    });

    const error = await service.upload(EQUIPO, 7, MENSAJE, archivo()).catch((e) => e);

    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getResponse()).toEqual({
      code: 'INTERNAL',
      message: 'No se pudo guardar el archivo adjunto.',
    });
    expect(storage.save).not.toHaveBeenCalled();
    expect(messages.createAttachment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// El reparto entre el disco y la fila.
// ---------------------------------------------------------------------------

describe('upload: ni fila sin archivo ni archivo sin fila', () => {
  it('escribe primero el archivo y solo después inserta la fila', async () => {
    const { service, orden } = makeHarness();

    await service.upload(EQUIPO, 7, MENSAJE, archivo());

    expect(orden).toEqual(['disco', 'fila']);
  });

  /**
   * El caso que decide el orden: si falla el `INSERT`, el archivo ya escrito se
   * borra. Un archivo sin fila es basura invisible; una fila sin archivo es un
   * adjunto roto en el hilo que además ocupa presupuesto.
   */
  it('si falla el INSERT se borra el archivo recién escrito', async () => {
    const { service, storage, escritos } = makeHarness({ fallaEn: 'fila' });

    await expect(service.upload(EQUIPO, 7, MENSAJE, archivo())).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    const clave = storage.save.mock.calls[0][1] as string;
    expect(storage.remove).toHaveBeenCalledWith(clave);
    expect(escritos.size).toBe(0);
  });

  it('si el borrado de compensación también falla, el error que sale sigue siendo el de la subida', async () => {
    const { service } = makeHarness({ fallaEn: 'fila', fallaElBorrado: true });

    const error = await service.upload(EQUIPO, 7, MENSAJE, archivo()).catch((e) => e);

    // El fallo del borrado no puede enmascarar al de la subida ni escaparse sin
    // envolver: quien llame recibe siempre el mismo `{ code, message }`.
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getResponse()).toEqual({
      code: 'INTERNAL',
      message: 'No se pudo guardar el archivo adjunto.',
    });
  });

  it('si falla la escritura en disco no se inserta ninguna fila', async () => {
    const { service, messages, filas } = makeHarness({ fallaEn: 'disco' });

    await expect(service.upload(EQUIPO, 7, MENSAJE, archivo())).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    expect(messages.createAttachment).not.toHaveBeenCalled();
    expect(filas).toHaveLength(0);
  });

  it('la subida buena deja archivo y fila apuntando a la misma clave', async () => {
    const { service, escritos, filas } = makeHarness();

    const guardado = await service.upload(EQUIPO, 7, MENSAJE, archivo());

    expect(escritos.size).toBe(1);
    expect(filas).toHaveLength(1);
    expect([...escritos.keys()][0]).toBe(filas[0].storageKey);
    expect(guardado.id).toBe(77);
  });
});

// ---------------------------------------------------------------------------
// Regla 5: el tope por ticket, y solo para el cliente.
// ---------------------------------------------------------------------------

describe('upload: el tope por ticket', () => {
  it('rechaza al cliente que se pasa del tope aunque el archivo suelto quepa', async () => {
    const { service, storage, messages } = makeHarness({ bytesDeCliente: MAX_TICKET_BYTES - 1024 });

    const error = await service
      .upload(CLIENTE, 7, MENSAJE, archivo({ buffer: png(2048) }))
      .catch((e) => e);

    expect(error).toBeInstanceOf(PayloadTooLargeException);
    expect(error.getResponse().code).toBe('PAYLOAD_TOO_LARGE');
    // Y dice qué hacer, no solo que está lleno.
    expect(error.getResponse().message).toMatch(/técnico/i);
    // Nada llega al disco: el tope se comprueba antes de escribir.
    expect(storage.save).not.toHaveBeenCalled();
    expect(messages.createAttachment).not.toHaveBeenCalled();
  });

  it('el cliente que cabe justo sí sube', async () => {
    const { service, filas } = makeHarness({ bytesDeCliente: MAX_TICKET_BYTES - 2048 });

    await service.upload(CLIENTE, 7, MENSAJE, archivo({ buffer: png(2048) }));

    expect(filas).toHaveLength(1);
  });

  it('el equipo no se ve afectado por el tope del ticket', async () => {
    const { service, messages, filas } = makeHarness({ bytesDeCliente: MAX_TICKET_BYTES * 2 });

    await service.upload(EQUIPO, 7, MENSAJE, archivo());

    expect(filas).toHaveLength(1);
    // Ni siquiera lo consulta: el tope no es suyo.
    expect(messages.sumClientBytes).not.toHaveBeenCalled();
  });

  it('la suma de lo ya ocupado se pide al servidor, por ticket', async () => {
    const { service, messages } = makeHarness();

    await service.upload(CLIENTE, 7, MENSAJE, archivo());

    expect(messages.sumClientBytes).toHaveBeenCalledWith(7);
  });
});

// ---------------------------------------------------------------------------
// Regla 4: de quién es el ticket. Y regla 5: de qué mensaje cuelga.
// ---------------------------------------------------------------------------

describe('upload: dónde se puede colgar un adjunto', () => {
  it('subir a un ticket de otra empresa da 404, no 403, y no toca el disco', async () => {
    const { service, storage } = makeHarness({ ticket: ticketRow({ clientId: OTRA_EMPRESA }) });

    const error = await service.upload(CLIENTE, 7, MENSAJE, archivo()).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(CUERPO_404_TICKET);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('un ticket inexistente da exactamente el mismo cuerpo', async () => {
    const { service } = makeHarness({ ticket: null });

    const error = await service.upload(CLIENTE, 404, MENSAJE, archivo()).catch((e) => e);

    expect(error.getResponse()).toEqual(CUERPO_404_TICKET);
  });

  it('el equipo sube a cualquier ticket, sea de la empresa que sea', async () => {
    const { service, filas } = makeHarness({ ticket: ticketRow({ clientId: OTRA_EMPRESA }) });

    await service.upload(EQUIPO, 7, MENSAJE, archivo());

    expect(filas).toHaveLength(1);
  });

  it('un ticket cerrado no admite adjuntos nuevos', async () => {
    const { service, storage } = makeHarness({ ticket: ticketRow({ status: 'CERRADO' }) });

    await expect(service.upload(EQUIPO, 7, MENSAJE, archivo())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(storage.save).not.toHaveBeenCalled();
  });

  /**
   * **Todo adjunto cuelga de un mensaje**, y así hereda su visibilidad sin
   * excepciones. Un adjunto sin mensaje es público incondicionalmente
   * (`listAttachments` lo deja pasar siempre al portal), así que permitir
   * subirlo «al ticket» era dejar que un técnico publicara sin querer el
   * volcado de logs -- justo lo que la regla 5 viene a impedir. Si hace falta
   * adjuntar al crear el ticket, se crea el ticket con su primer mensaje y el
   * archivo cuelga de ahí.
   */
  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('subir sin mensaje se rechaza limpio y no toca el disco: %s', async (_n, messageId) => {
    const { service, storage, messages } = makeHarness();

    const error = await service
      .upload(EQUIPO, 7, messageId as unknown as number, archivo())
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse().code).toBe('BAD_INPUT');
    expect(storage.save).not.toHaveBeenCalled();
    expect(messages.createAttachment).not.toHaveBeenCalled();
  });

  it('un mensaje inexistente da 404 sin escribir nada', async () => {
    const { service, storage } = makeHarness({ mensaje: null });

    const error = await service.upload(EQUIPO, 7, MENSAJE, archivo()).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(CUERPO_404_MENSAJE);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('un mensaje de otro ticket da el mismo 404', async () => {
    const { service } = makeHarness({ mensaje: messageRow({ ticketId: 99 }) });

    const error = await service.upload(EQUIPO, 7, MENSAJE, archivo()).catch((e) => e);

    expect(error.getResponse()).toEqual(CUERPO_404_MENSAJE);
  });

  /** Una nota interna no existe para el cliente: tampoco para colgarle un archivo. */
  it('el cliente no puede colgar un adjunto de una nota interna: mismo 404', async () => {
    const { service, storage } = makeHarness({ mensaje: messageRow({ visibility: 'INTERNA' }) });

    const error = await service.upload(CLIENTE, 7, MENSAJE, archivo()).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(CUERPO_404_MENSAJE);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('el equipo sí adjunta a su propia nota interna', async () => {
    const { service, filas } = makeHarness({ mensaje: messageRow({ visibility: 'INTERNA' }) });

    await service.upload(EQUIPO, 7, MENSAJE, archivo());

    expect(filas[0].messageId).toBe(MENSAJE);
  });
});

describe('upload: columnas de quién subió y lo que devuelve', () => {
  it('el cliente pone uploaded_by_client_user_id y deja nulo el del equipo', async () => {
    const { service, filas } = makeHarness();

    await service.upload(CLIENTE, 7, MENSAJE, archivo());

    expect(filas[0].uploadedByClientUserId).toBe(11);
    expect(filas[0].uploadedByUserId).toBeNull();
  });

  it('el equipo pone uploaded_by_user_id y deja nulo el de cliente', async () => {
    const { service, filas } = makeHarness();

    await service.upload(EQUIPO, 7, MENSAJE, archivo());

    expect(filas[0].uploadedByUserId).toBe(5);
    expect(filas[0].uploadedByClientUserId).toBeNull();
  });

  /**
   * Lo que sale del servicio es una proyección campo por campo, igual que la de
   * `list`: devolver la entidad publicaría la clave del almacenamiento en la
   * respuesta de la propia subida.
   */
  it('devuelve la proyección, no la entidad con la clave dentro', async () => {
    const { service } = makeHarness();

    const salida = await service.upload(CLIENTE, 7, MENSAJE, archivo());

    expect(Object.keys(salida).sort()).toEqual([
      'createdAt',
      'filename',
      'id',
      'messageId',
      'mimeType',
      'size',
    ]);
    expect(JSON.stringify(salida)).not.toContain('tickets/');
  });

  it('un actor.kind desconocido no escribe nada, ni en disco ni en la tabla', async () => {
    const { service, tickets, storage, messages } = makeHarness();

    await expect(
      service.upload({ kind: 'ROBOT', userId: 1 } as any, 7, MENSAJE, archivo()),
    ).rejects.toThrow();

    expect(tickets.findById).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(messages.createAttachment).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['cero', 0],
    ['cadena vacía', ''],
  ])('un actor de cliente sin clientId utilizable no sube nada: %s', async (_n, clientId) => {
    const { service, tickets, storage } = makeHarness();

    await expect(
      service.upload({ kind: 'CLIENT', clientUserId: 11, clientId } as any, 7, MENSAJE, archivo()),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(tickets.findById).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Reglas 3, 4 y 5: la descarga.
// ---------------------------------------------------------------------------

describe('download', () => {
  it('devuelve el flujo, el nombre original, el tipo detectado y el tamaño', async () => {
    const { service, storage, streamFalso } = makeHarness({
      adjunto: attachmentRow({
        filename: 'factura.png',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      }),
    });

    const salida = await service.download(CLIENTE, 77);

    expect(salida).toEqual({
      stream: streamFalso,
      filename: 'factura.png',
      // El tipo **detectado** en la subida, no el que declaró quien la hizo:
      // es lo que el controlador pone en `Content-Type` al forzar la descarga.
      mimeType: 'application/pdf',
      size: 2048,
    });
    expect(storage.createReadStream).toHaveBeenCalledWith('tickets/7/9f2c-uuid.png');
  });

  it('un adjunto inexistente da 404 sin abrir ningún flujo', async () => {
    const { service, storage } = makeHarness({ adjunto: null });

    const error = await service.download(CLIENTE, 404).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(CUERPO_404_ADJUNTO);
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  /** Regla 4: lo ajeno y lo inexistente son indistinguibles. */
  it('el adjunto de otra empresa da 404 con el mismo cuerpo que uno inexistente', async () => {
    const { service, storage } = makeHarness({
      adjunto: attachmentRow(),
      ticket: ticketRow({ clientId: OTRA_EMPRESA }),
    });

    const error = await service.download(CLIENTE, 77).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(CUERPO_404_ADJUNTO);
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  it('un adjunto cuyo ticket ya no existe da el mismo 404', async () => {
    const { service } = makeHarness({ adjunto: attachmentRow(), ticket: null });

    const error = await service.download(CLIENTE, 77).catch((e) => e);

    expect(error.getResponse()).toEqual(CUERPO_404_ADJUNTO);
  });

  it('un ticket sin empresa no es de nadie del portal', async () => {
    const { service } = makeHarness({
      adjunto: attachmentRow(),
      ticket: ticketRow({ clientId: null }),
    });

    const error = await service.download(CLIENTE, 77).catch((e) => e);

    expect(error.getResponse()).toEqual(CUERPO_404_ADJUNTO);
  });

  /** Regla 5: el adjunto hereda la visibilidad de su mensaje. */
  it('desde el portal, el adjunto de una nota interna da 404 con el mismo cuerpo', async () => {
    const { service, storage } = makeHarness({
      adjunto: attachmentRow({ messageId: MENSAJE }),
      mensaje: messageRow({ visibility: 'INTERNA' }),
    });

    const error = await service.download(CLIENTE, 77).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(CUERPO_404_ADJUNTO);
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  /**
   * La visibilidad se hereda del mensaje **de ese ticket**. Un adjunto que
   * apuntara a un mensaje público de otro ticket heredaría una visibilidad que
   * nadie eligió, y la comprobación de pertenencia del ticket dejaría de decir
   * nada sobre lo que de verdad se sirve.
   */
  it('un adjunto que apunta a un mensaje de otro ticket da 404', async () => {
    const { service, storage } = makeHarness({
      adjunto: attachmentRow({ ticketId: 7, messageId: MENSAJE }),
      mensaje: messageRow({ ticketId: 99, visibility: 'PUBLICA' }),
    });

    const error = await service.download(CLIENTE, 77).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(CUERPO_404_ADJUNTO);
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  it('el equipo sí descarga el adjunto de una nota interna', async () => {
    const { service, messages } = makeHarness({
      adjunto: attachmentRow({ messageId: MENSAJE }),
      mensaje: messageRow({ visibility: 'INTERNA' }),
    });

    const salida = await service.download(EQUIPO, 77);

    expect(salida.filename).toBe('captura.png');
    // Al equipo no le hace falta ni mirar la visibilidad del mensaje.
    expect(messages.findMessage).not.toHaveBeenCalled();
  });

  it('el cliente sí descarga el adjunto de un mensaje público de su ticket', async () => {
    const { service } = makeHarness({
      adjunto: attachmentRow({ messageId: MENSAJE }),
      mensaje: messageRow({ visibility: 'PUBLICA' }),
    });

    const salida = await service.download(CLIENTE, 77);

    expect(salida.filename).toBe('captura.png');
  });

  it('un adjunto colgado de un mensaje que ya no está da 404, no un flujo', async () => {
    const { service } = makeHarness({ adjunto: attachmentRow(), mensaje: null });

    const error = await service.download(CLIENTE, 77).catch((e) => e);

    expect(error.getResponse()).toEqual(CUERPO_404_ADJUNTO);
  });

  /**
   * Las filas con `message_id` nulo ya no las puede crear `upload`, pero la
   * consulta las sigue tratando como públicas por si existiera alguna: son las
   * que se habrían subido al abrir el ticket, del propio cliente.
   */
  it('una fila sin mensaje la sigue descargando el cliente', async () => {
    const { service } = makeHarness({ adjunto: attachmentRow({ messageId: null }) });

    const salida = await service.download(CLIENTE, 77);

    expect(salida.size).toBe(1024);
  });

  /**
   * TypeORM hidrata toda columna `bigint` como cadena: con `===`, el dueño
   * legítimo se comería un 404 y el guardia parecería funcionar.
   */
  it('el dueño legítimo pasa aunque los ids lleguen como cadena', async () => {
    const { service } = makeHarness({
      adjunto: attachmentRow({
        ticketId: '7' as unknown as number,
        messageId: '501' as unknown as number,
      }),
      ticket: ticketRow({
        id: '7' as unknown as number,
        clientId: String(EMPRESA) as unknown as number,
      }),
      mensaje: messageRow({
        id: '501' as unknown as number,
        ticketId: '7' as unknown as number,
      }),
    });

    const salida = await service.download(CLIENTE, '77');

    expect(salida.filename).toBe('captura.png');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['cero', 0],
    ['cadena vacía', ''],
  ])('un actor de cliente sin clientId utilizable no descarga nada: %s', async (_n, clientId) => {
    const { service, messages, storage } = makeHarness({ adjunto: attachmentRow() });

    await expect(
      service.download({ kind: 'CLIENT', clientUserId: 11, clientId } as any, 77),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(messages.findAttachment).not.toHaveBeenCalled();
    expect(storage.createReadStream).not.toHaveBeenCalled();
  });

  it('un actor.kind desconocido no descarga nada', async () => {
    const { service, messages } = makeHarness({ adjunto: attachmentRow() });

    await expect(service.download({ kind: 'ROBOT' } as any, 77)).rejects.toThrow();

    expect(messages.findAttachment).not.toHaveBeenCalled();
  });
});

describe('list', () => {
  it('un actor de cliente nunca pide los adjuntos de las notas internas', async () => {
    const { service, messages } = makeHarness();

    await service.list(CLIENTE, 7);

    expect(messages.listAttachments).toHaveBeenCalledWith(7, { includeInternal: false });
  });

  it('el equipo ve todos los adjuntos del ticket', async () => {
    const { service, messages } = makeHarness();

    await service.list(EQUIPO, 7);

    expect(messages.listAttachments).toHaveBeenCalledWith(7, { includeInternal: true });
  });

  /**
   * El interruptor de visibilidad cuelga del `kind` del actor, **nunca de la
   * presencia de un dato**. Con `ids.clientUserId === null` decidiendo, un
   * actor de cliente al que le faltara el `clientUserId` --que `assertClientScope`
   * no mira, porque solo comprueba el `clientId`-- salía con las notas internas
   * incluidas: el guardia se apagaba solo justo cuando le faltaba su dato, que
   * es la forma exacta del fallo que `ClientScope` existe para erradicar.
   */
  it('un actor de cliente sin clientUserId tampoco ve los adjuntos internos', async () => {
    const { service, messages } = makeHarness();

    await service.list({ kind: 'CLIENT', clientUserId: null, clientId: EMPRESA } as any, 7);

    expect(messages.listAttachments).toHaveBeenCalledWith(7, { includeInternal: false });
  });

  it('listar los de otra empresa da 404, no 403', async () => {
    const { service, messages } = makeHarness({ ticket: ticketRow({ clientId: OTRA_EMPRESA }) });

    const error = await service.list(CLIENTE, 7).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(CUERPO_404_TICKET);
    expect(messages.listAttachments).not.toHaveBeenCalled();
  });

  /**
   * Regla 4 del diseño: la proyección va campo por campo para todo lo que ve un
   * cliente. Devolver la entidad entera publicaría la **clave del
   * almacenamiento**, el id de quien subió y cualquier columna que se añada
   * mañana -- y un `spread` con una lista negra encima se rompe solo la próxima
   * vez que alguien toque la entidad.
   */
  it('proyecta campo por campo: ni clave de almacenamiento ni quién subió', async () => {
    const { service } = makeHarness({ adjuntos: [attachmentRow()] });

    const [salida] = await service.list(CLIENTE, 7);

    expect(salida).toEqual({
      id: 77,
      messageId: MENSAJE,
      filename: 'captura.png',
      mimeType: 'image/png',
      size: 1024,
      createdAt: new Date('2026-08-06T10:00:00.000Z'),
    });
    const serializado = JSON.stringify(salida);
    expect(serializado).not.toContain('tickets/7/');
    expect(serializado).not.toContain('uploadedBy');
    expect(serializado).not.toContain('storageKey');
  });
});
