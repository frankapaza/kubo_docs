import { CallHandler, ExecutionContext, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { firstValueFrom, of } from 'rxjs';
import { Repository } from 'typeorm';

import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ApiThrottlerGuard, THROTTLED_MESSAGE } from '../../common/guards/api-throttler.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import {
  BULK_INVITE_THROTTLE,
  BULK_REVIEW_THROTTLE,
  PORTAL_AUTH_THROTTLERS,
  THROTTLER_BURST,
  THROTTLER_SUSTAINED,
} from '../../config/throttler.config';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { BULK_TEMPLATE_FILENAME, BULK_TEMPLATE_MIME } from './bulk-users-workbook';
import { ClientUsersBulkService } from './client-users-bulk.service';
import { ClientUsersController } from './client-users.controller';
import { ClientUsersService } from './client-users.service';
import {
  BULK_UPLOAD_LIMITS,
  MAX_BULK_FILE_BYTES,
  MAX_BULK_ROWS,
  MAX_EMAIL_LENGTH,
  MAX_FULL_NAME_LENGTH,
} from './domain/bulk-user-file';
import {
  BULK_SEND_JSON_LIMIT_BYTES,
  MAX_REVISION_LENGTH,
  REVIEW_VERSION,
  deriveReviewKey,
  encodeReview,
  reviewMac,
} from './domain/bulk-users-review';
import { BulkUploadErrorsInterceptor } from './interceptors/bulk-upload-errors.interceptor';

/** Los metadatos que un decorador deja sobre un método del controlador. */
function metodo(nombre: string) {
  return (ClientUsersController.prototype as never)[nombre];
}
const rolesDe = (m: string): string[] | undefined => Reflect.getMetadata(ROLES_KEY, metodo(m));
const interceptoresDe = (m: string): unknown[] =>
  Reflect.getMetadata(INTERCEPTORS_METADATA, metodo(m)) ?? [];
const guardasDe = (m: string): unknown[] => Reflect.getMetadata(GUARDS_METADATA, metodo(m)) ?? [];

const TRES_RUTAS = ['bulkTemplate', 'bulkReview', 'bulkSend'];

describe('las tres rutas de carga masiva: metadatos', () => {
  it('las tres exigen rol ADMIN, como sus hermanas mutantes del mismo controlador', () => {
    for (const m of TRES_RUTAS) expect(rolesDe(m)).toEqual(['ADMIN']);
    expect(rolesDe('create')).toEqual(['ADMIN']);
  });

  it('el traductor de errores de subida va POR DELANTE de FileInterceptor', () => {
    // Es su `next.handle()` el que envuelve a la subida: al revés, no ve nada.
    const [primero] = interceptoresDe('bulkReview');
    expect(primero).toBe(BulkUploadErrorsInterceptor);
    expect(interceptoresDe('bulkReview')).toHaveLength(2);
  });

  it('el envío y la revisión llevan tope; la plantilla no, que no cuesta nada', () => {
    expect(guardasDe('bulkSend')).toContain(ApiThrottlerGuard);
    expect(guardasDe('bulkReview')).toContain(ApiThrottlerGuard);
    expect(guardasDe('bulkTemplate')).not.toContain(ApiThrottlerGuard);
  });

  it('el tope de envío es estrecho: una carga se hace una vez, y dos clientes seguidos caben', () => {
    expect(BULK_INVITE_THROTTLE[THROTTLER_BURST].limit).toBe(1);
    expect(BULK_INVITE_THROTTLE[THROTTLER_SUSTAINED].limit).toBe(3);
  });

  it('el de la revisión es mucho más laxo: corregir y volver a subir es su razón de ser', () => {
    expect(BULK_REVIEW_THROTTLE[THROTTLER_BURST].limit).toBeGreaterThan(
      BULK_INVITE_THROTTLE[THROTTLER_BURST].limit,
    );
    expect(BULK_REVIEW_THROTTLE[THROTTLER_SUSTAINED].limit).toBeGreaterThan(
      BULK_INVITE_THROTTLE[THROTTLER_SUSTAINED].limit,
    );
    // Y acotado: cada revisión arranca un hilo de 64 MB, así que el techo del
    // agregado es este número por esos megas. Ver `BULK_REVIEW_THROTTLE`.
    expect(BULK_REVIEW_THROTTLE[THROTTLER_BURST].limit).toBe(6);
  });

  it('el tope de tamaño del archivo es el del dominio, y es un solo archivo', () => {
    expect(BULK_UPLOAD_LIMITS.fileSize).toBe(MAX_BULK_FILE_BYTES);
    expect(BULK_UPLOAD_LIMITS.files).toBe(1);
  });
});

describe('el cableado de cada ruta', () => {
  const servicio = {
    template: jest.fn(async () => Buffer.from('xlsx')),
    review: jest.fn(async () => ({ rows: [] })),
    send: jest.fn(async () => ({ rows: [], totals: {} })),
  };
  const controller = new ClientUsersController({} as never, servicio as never);

  beforeEach(() => jest.clearAllMocks());

  it('la revisión pasa el clientId de la QUERY y el buffer del archivo', async () => {
    await controller.bulkReview(7, { buffer: Buffer.from('x') } as never);
    expect(servicio.review).toHaveBeenCalledWith(7, Buffer.from('x'));
  });

  it('sin archivo, un 400 en español y no un TypeError', async () => {
    await expect(controller.bulkReview(7, undefined as never)).rejects.toThrow(/archivo/i);
  });

  it('el envío toma el id del PERSONAL de la sesión, y la empresa de la URL; nunca del cuerpo', async () => {
    const dto = { revision: 'r', mac: 'f'.repeat(64) };
    await controller.bulkSend({ id: 40 } as never, 7, dto);
    expect(servicio.send).toHaveBeenCalledWith(40, 7, dto);
  });
});

/** Contexto mínimo: el rol de quien pide y el manejador al que apunta. */
function contextoCon(role: string, m: string): ExecutionContext {
  return {
    getHandler: () => metodo(m),
    getClass: () => ClientUsersController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 1, email: 'a@b.c', role } }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard sobre las tres rutas', () => {
  const guard = new RolesGuard(new Reflector());

  it.each(TRES_RUTAS)('un ADMIN pasa por %s', (m) => {
    expect(guard.canActivate(contextoCon('ADMIN', m))).toBe(true);
  });

  it.each(TRES_RUTAS)('un DEVELOPER NO pasa por %s', (m) => {
    expect(() => guard.canActivate(contextoCon('DEVELOPER', m))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// HTTP de verdad: guardas montadas, no solo decoradores.
// ---------------------------------------------------------------------------

const SECRETO_PERSONAL = 'secreto-de-pruebas-del-personal';
const CLAVE = deriveReviewKey(SECRETO_PERSONAL);
const jwt = new JwtService({});
const token = (role: string) =>
  jwt.sign({ sub: 40, email: 'op@kubo.pe', role }, { secret: SECRETO_PERSONAL, expiresIn: '5m' });
const ADMIN = () => token('ADMIN');
const DEVELOPER = () => token('DEVELOPER');

const ANA = { line: 2, fullName: 'Ana Pérez', email: 'ana@x.com' };

function bloque(clientId = 7, filas = [ANA]) {
  const revision = encodeReview({ v: REVIEW_VERSION, clientId, issuedAt: Date.now(), rows: filas });
  return { revision, mac: reviewMac(CLAVE, revision) };
}

interface Mundo {
  invitadas: string[];
  clientes: number[];
}

/** El servicio REAL de carga masiva sobre repositorios de mentira. */
function servicioReal(m: Mundo) {
  const clients = {
    findByIdOrFail: async (id: number) => {
      if (!m.clientes.includes(id)) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Cliente no encontrado' });
      }
      return { id, razonSocial: 'ACME S.A.C.', status: 'CLIENT' };
    },
  };
  const portalInvitations = {
    invite: async (_c: number, _a: unknown, dto: { email: string; fullName: string }) => {
      m.invitadas.push(dto.email);
      return {
        id: m.invitadas.length,
        fullName: dto.fullName,
        email: dto.email,
        expiresAt: '2026-09-16T00:00:00.000Z',
        lastSentAt: '2026-09-09T00:00:00.000Z',
        deliveryFailed: false,
        createdAt: '2026-09-09T00:00:00.000Z',
      };
    },
  };
  return new ClientUsersBulkService(
    { findByEmail: async () => null } as never,
    { findLiveByEmail: async () => null } as never,
    clients as never,
    portalInvitations as never,
    new ConfigService({ JWT_ACCESS_SECRET: SECRETO_PERSONAL }),
  );
}

const CSV = 'Nombre completo,Correo electrónico\nAna Pérez,ana@x.com\n';

function multipart(contenido: Buffer | string, nombre = 'file', filename = 'usuarios.csv') {
  const form = new FormData();
  form.append(nombre, new Blob([new Uint8Array(Buffer.from(contenido))]), filename);
  return form;
}

describe('las tres rutas por HTTP, con las guardas de verdad', () => {
  let app: TestHttpApp;
  let mundo: Mundo;

  beforeEach(async () => {
    mundo = { invitadas: [], clientes: [7] };
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule,
        ThrottlerModule.forRoot({ throttlers: PORTAL_AUTH_THROTTLERS }),
      ],
      controllers: [ClientUsersController],
      providers: [
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: string) => (k === 'JWT_ACCESS_SECRET' ? SECRETO_PERSONAL : d) },
        },
        JwtStrategy,
        { provide: ClientUsersService, useValue: {} },
        { provide: ClientUsersBulkService, useValue: servicioReal(mundo) },
      ],
    }).compile();
    app = await startTestHttpApp(moduleRef);
  });

  afterEach(async () => {
    await app?.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const subir = (t: string | null, form: FormData, q = '?clientId=7') =>
    app.raw(`/client-users/carga-masiva/revision${q}`, {
      method: 'POST',
      headers: t ? auth(t) : {},
      body: form,
    });
  const enviar = (t: string | null, body: unknown, q = '?clientId=7') =>
    app.raw(`/client-users/carga-masiva/envio${q}`, {
      method: 'POST',
      headers: { ...(t ? auth(t) : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const plantilla = (t: string | null) =>
    app.raw('/client-users/carga-masiva/plantilla', { headers: t ? auth(t) : {} });

  describe('sin credencial: 401; con personal sin el rol: 403', () => {
    it('plantilla', async () => {
      expect((await plantilla(null)).status).toBe(401);
      expect((await plantilla(DEVELOPER())).status).toBe(403);
    });

    it('revisión', async () => {
      expect((await subir(null, multipart(CSV))).status).toBe(401);
      expect((await subir(DEVELOPER(), multipart(CSV))).status).toBe(403);
    });

    it('envío: y ni el 401 ni el 403 invitan a nadie ni gastan el tope', async () => {
      expect((await enviar(null, bloque())).status).toBe(401);
      expect((await enviar(DEVELOPER(), bloque())).status).toBe(403);
      expect(mundo.invitadas).toEqual([]);
      // El tope no se gastó: el primer envío legítimo todavía pasa.
      expect((await enviar(ADMIN(), bloque())).status).toBe(200);
    });
  });

  describe('la plantilla', () => {
    it('llega como hoja de cálculo, forzada a descarga y con el nombre correcto', async () => {
      const res = await plantilla(ADMIN());
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe(BULK_TEMPLATE_MIME);
      expect(res.headers.get('content-disposition')).toBe(
        `attachment; filename="${BULK_TEMPLATE_FILENAME}"`,
      );
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(res.headers.get('content-length')).toBe(String(bytes.length));
      // Un .xlsx es un ZIP.
      expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('el nombre y el tipo son los de una hoja de cálculo, no otra cosa', () => {
      expect(BULK_TEMPLATE_FILENAME).toMatch(/\.xlsx$/);
      expect(BULK_TEMPLATE_MIME).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    });
  });

  describe('la revisión', () => {
    it('un archivo bueno devuelve 200 y la revisión, sin invitar a nadie', async () => {
      const res = await subir(ADMIN(), multipart(CSV));
      expect(res.status).toBe(200);
      const cuerpo = await res.json();
      expect(cuerpo.clientId).toBe(7);
      expect(cuerpo.totals.willInvite).toBe(1);
      expect(mundo.invitadas).toEqual([]);
    });

    it('una empresa que no existe es 404, nunca 403', async () => {
      const res = await subir(ADMIN(), multipart(CSV), '?clientId=999');
      expect(res.status).toBe(404);
    });

    it('sin clientId, o con uno que no es número: 400', async () => {
      expect((await subir(ADMIN(), multipart(CSV), '')).status).toBe(400);
      expect((await subir(ADMIN(), multipart(CSV), '?clientId=abc')).status).toBe(400);
    });

    it('sin archivo: 400 en español', async () => {
      const res = await subir(ADMIN(), new FormData());
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toMatch(/archivo/i);
    });

    it('un archivo que no es lo que dice (basura con nombre .xlsx) es 400, no 500', async () => {
      const res = await subir(
        ADMIN(),
        multipart(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]), 'file', 'usuarios.xlsx'),
      );
      expect(res.status).toBe(400);
    });

    it('un archivo por encima del tope es 413 en español, cortado por el interceptor', async () => {
      const res = await subir(ADMIN(), multipart(Buffer.alloc(MAX_BULK_FILE_BYTES + 1024, 'a')));
      expect(res.status).toBe(413);
      const cuerpo = await res.json();
      expect(cuerpo.code).toBe('PAYLOAD_TOO_LARGE');
      expect(JSON.stringify(cuerpo)).toMatch(/KB/);
    });

    it('el campo con otro nombre, un segundo archivo o un campo de texto de más: 400', async () => {
      expect((await subir(ADMIN(), multipart(CSV, 'otro'))).status).toBe(400);

      const dos = multipart(CSV);
      dos.append('file', new Blob([CSV]), 'otro.csv');
      expect((await subir(ADMIN(), dos)).status).toBe(400);

      const conCampo = multipart(CSV);
      conCampo.append('clientId', '9');
      expect((await subir(ADMIN(), conCampo)).status).toBe(400);
    });

    it('se puede corregir y volver a subir varias veces seguidas, pero no sin fin', async () => {
      const permitidas = BULK_REVIEW_THROTTLE[THROTTLER_BURST].limit;
      for (let i = 0; i < permitidas; i++) {
        expect((await subir(ADMIN(), multipart(CSV))).status).toBe(200);
      }
      // La siguiente ya no: cada revisión arranca un hilo con 64 MB de tope, y
      // sin techo varias a la vez son varias veces 64 MB.
      expect((await subir(ADMIN(), multipart(CSV))).status).toBe(429);
    });
  });

  describe('el envío', () => {
    it('invita, y la respuesta dice para qué empresa', async () => {
      const res = await enviar(ADMIN(), bloque());
      expect(res.status).toBe(200);
      const cuerpo = await res.json();
      expect(cuerpo.clientId).toBe(7);
      expect(cuerpo.totals.invited).toBe(1);
      expect(mundo.invitadas).toEqual(['ana@x.com']);
    });

    it('el tope de frecuencia RECHAZA de verdad: el segundo seguido es 429 y no invita', async () => {
      expect((await enviar(ADMIN(), bloque())).status).toBe(200);
      const segundo = await enviar(ADMIN(), bloque(7, [{ ...ANA, email: 'otra@x.com' }]));
      expect(segundo.status).toBe(429);
      expect(await segundo.json()).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: THROTTLED_MESSAGE,
      });
      expect(mundo.invitadas).toEqual(['ana@x.com']);
    });

    it('una revisión de otra empresa que la de la URL se rechaza, sin invitar', async () => {
      mundo.clientes.push(9);
      const res = await enviar(ADMIN(), bloque(9), '?clientId=7');
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(403);
      expect(JSON.stringify(await res.json())).toMatch(/otra empresa/i);
      expect(mundo.invitadas).toEqual([]);
    });

    // Una petición por prueba: el tope cuenta antes que el pipe, así que una
    // segunda en la misma aplicación saldría 429 y taparía el 400 que se mira.
    it('sin clientId en la URL: 400 y no invita', async () => {
      expect((await enviar(ADMIN(), bloque(), '')).status).toBe(400);
      expect(mundo.invitadas).toEqual([]);
    });

    it('con un clientId ilegible: 400 y no invita', async () => {
      expect((await enviar(ADMIN(), bloque(), '?clientId=7abc')).status).toBe(400);
      expect(mundo.invitadas).toEqual([]);
    });

    /**
     * **El tope que se anuncia tiene que caber por su propio tubo.** El
     * analizador de JSON de express trae 100 KB y rechaza antes de cualquier
     * guarda, pipe o controlador: una revisión legítima de 200 filas con
     * nombres y correos largos los pasa, así que la pantalla ofrecía un tope
     * que moría en su extremo. Esta prueba manda exactamente ese caso.
     */
    it('una revisión de 200 filas con nombres y correos largos pasa entera', async () => {
      const filas = Array.from({ length: MAX_BULK_ROWS }, (_, i) => ({
        line: i + 2,
        fullName: `Añá ${'ñ'.repeat(MAX_FULL_NAME_LENGTH - 10)}`,
        email: `${'a'.repeat(MAX_EMAIL_LENGTH - 30)}${i}@correo-largo.com`,
      }));
      const cuerpo = bloque(7, filas);

      // Que el caso es el que dice: por encima de los 100 KB de serie.
      expect(JSON.stringify(cuerpo).length).toBeGreaterThan(100 * 1024);

      const res = await enviar(ADMIN(), cuerpo);
      expect(res.status).toBe(200);
      expect((await res.json()).totals.invited).toBe(MAX_BULK_ROWS);
    });

    it('un cuerpo que se pasa del tope es 413 con el cuerpo de la casa, nunca 500', async () => {
      const res = await enviar(ADMIN(), {
        revision: 'x'.repeat(BULK_SEND_JSON_LIMIT_BYTES + 1024),
        mac: 'a'.repeat(64),
      });
      expect(res.status).toBe(413);
      expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE');
      expect(mundo.invitadas).toEqual([]);
    });
  });
});

describe('el tope de JSON de la ruta de envío', () => {
  it('admite el peor cuerpo posible con holgura, y lo calcula en vez de adivinarlo', () => {
    // El cuerpo más grande que esta ruta puede recibir de buena fe: el bloque
    // de 200 filas largas, su firma y las comillas de los dos.
    const PEOR_CUERPO = MAX_REVISION_LENGTH + 64 + 40;
    expect(BULK_SEND_JSON_LIMIT_BYTES).toBeGreaterThan(PEOR_CUERPO);
    // Y el tope de la validación es el mismo número derivado, no un redondeo
    // a ojo que se quede corto como el anterior (200 000).
    expect(MAX_REVISION_LENGTH).toBeGreaterThan(200_000);
  });
});

/**
 * El tope de envío cuenta TODA petición que llega al guard, válida o no (corre
 * antes que el pipe). Para ver el 400 de forma sin que el 429 lo tape, cada
 * intento va con su propia aplicación.
 *
 * **Y cada intento espía el servicio**, que es lo que hace que estas pruebas
 * prueben algo. Antes todos los cuerpos malos llevaban una revisión que el
 * servicio habría rechazado igual —`revision: 'x'`—, así que daban 400 con los
 * decoradores del DTO puestos y sin ellos: las mutaciones del DTO y la del
 * pipe estricto sobrevivían enteras. Lo que distingue un orden del otro no es
 * el código de estado: es si el servicio llega a enterarse.
 */
async function conAplicacionPropia(
  prueba: (app: TestHttpApp, espia: jest.SpyInstance, mundo: Mundo) => Promise<void>,
): Promise<void> {
  const mundo: Mundo = { invitadas: [], clientes: [7] };
  const servicio = servicioReal(mundo);
  const espia = jest.spyOn(servicio, 'send');
  const moduleRef = await Test.createTestingModule({
    imports: [PassportModule, ThrottlerModule.forRoot({ throttlers: PORTAL_AUTH_THROTTLERS })],
    controllers: [ClientUsersController],
    providers: [
      {
        provide: ConfigService,
        useValue: { get: (k: string, d?: string) => (k === 'JWT_ACCESS_SECRET' ? SECRETO_PERSONAL : d) },
      },
      JwtStrategy,
      { provide: ClientUsersService, useValue: {} },
      { provide: ClientUsersBulkService, useValue: servicio },
    ],
  }).compile();
  const app = await startTestHttpApp(moduleRef);
  try {
    await prueba(app, espia, mundo);
  } finally {
    await app.close();
  }
}

const enviarCrudo = (app: TestHttpApp, cuerpo: unknown) =>
  app.raw('/client-users/carga-masiva/envio?clientId=7', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

describe('la validación del cuerpo corta ANTES del servicio', () => {
  // Un bloque de verdad: firma buena y empresa buena. Si el DTO no lo parara,
  // el servicio lo aceptaría — y eso es justo lo que mide la prueba.
  const BUENO = bloque();

  const casos: [string, unknown][] = [
    ['un bloque firmado válido más un campo de más', { ...BUENO, clientId: 9 }],
    ['una firma de 64 caracteres que no es hexadecimal', { ...BUENO, mac: 'G'.repeat(64) }],
    ['una firma hexadecimal en MAYÚSCULAS', { ...BUENO, mac: 'A'.repeat(64) }],
    ['una revisión vacía', { revision: '', mac: BUENO.mac }],
    ['una revisión que se pasa del tope derivado', {
      revision: 'x'.repeat(MAX_REVISION_LENGTH + 1),
      mac: BUENO.mac,
    }],
    ['sin cuerpo', {}],
  ];

  it.each(casos)('%s: 400, el servicio ni se entera y nada se invita', (_n, cuerpo) =>
    conAplicacionPropia(async (app, espia, mundo) => {
      const res = await enviarCrudo(app, cuerpo);
      expect(res.status).toBe(400);
      expect(espia).not.toHaveBeenCalled();
      expect(mundo.invitadas).toEqual([]);
    }),
  );
});

describe('las formas malas llegan al 400 de forma, no al tope', () => {
  const casos: [string, unknown][] = [
    ['firma numérica', { revision: 'x', mac: 123 }],
    ['firma en lista', { revision: 'x', mac: ['a'.repeat(64)] }],
    ['firma en objeto', { revision: 'x', mac: { a: 'b' } }],
    ['revisión numérica', { revision: 5, mac: 'a'.repeat(64) }],
  ];

  it.each(casos)('%s: 400 y nada se invita', (_n, cuerpo) =>
    conAplicacionPropia(async (app, _espia, mundo) => {
      expect((await enviarCrudo(app, cuerpo)).status).toBe(400);
      expect(mundo.invitadas).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------

/**
 * El asiento que dejaría en `audit_log` un POST con ese cuerpo y esa
 * respuesta. Mismo montaje que `audit.interceptor.spec.ts`.
 */
async function asientoDe(body: unknown, response: unknown) {
  const guardados: Partial<AuditLog>[] = [];
  const repo = {
    create: (data: Partial<AuditLog>) => data,
    save: async (data: Partial<AuditLog>) => void guardados.push(data),
  };
  const interceptor = new AuditInterceptor(repo as unknown as Repository<AuditLog>);
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/api/v1/client-users/carga-masiva/envio?clientId=7',
        route: { path: '/api/v1/client-users/carga-masiva/envio' },
        body,
        headers: {},
        ip: '10.0.0.1',
        user: { id: 40, email: 'admin@kubo.pe', role: 'ADMIN' },
      }),
    }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of(response) };

  await firstValueFrom(interceptor.intercept(ctx, next));
  return guardados[0] as Partial<AuditLog> & { payloadJson: { request: unknown; response: any } };
}

describe('lo que esta funcionalidad deja en audit_log', () => {
  const CUERPO = { revision: 'eyJ2IjoxfQ', mac: 'a'.repeat(64) };
  const RESPUESTA = {
    clientId: 7,
    rows: [{ line: 2, fullName: 'Ana Pérez', email: 'ana@x.com', outcome: 'INVITADA', reason: null }],
    totals: { invited: 1, invitedWithoutEmail: 0, skipped: 0, failed: 0 },
  };

  it('la respuesta del envío no lleva nada con la forma de un secreto', async () => {
    const asiento = await asientoDe(CUERPO, RESPUESTA);
    expect(JSON.stringify(asiento.payloadJson.response)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it('cada fila del informe lleva exactamente cinco campos, y ninguno es un secreto', async () => {
    const asiento = await asientoDe(CUERPO, RESPUESTA);
    const fila = asiento.payloadJson.response.rows[0];
    expect(Object.keys(fila).sort()).toEqual(['email', 'fullName', 'line', 'outcome', 'reason']);
  });

  it('«mac» NO se tacha, y eso es deliberado: no es una credencial', async () => {
    const asiento = await asientoDe(CUERPO, RESPUESTA);
    expect(JSON.stringify(asiento.payloadJson.request)).toContain('a'.repeat(64));
  });

  it('queda constancia de PARA QUÉ EMPRESA fue la carga', async () => {
    // El asiento guarda `route.path` (la plantilla de la ruta, sin la query ni
    // los parámetros), así que la URL sola NO lo dice: lo dice la respuesta.
    const asiento = await asientoDe(CUERPO, RESPUESTA);
    expect(asiento.payloadJson.response.clientId).toBe(7);
  });
});
