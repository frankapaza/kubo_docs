import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { NotificationTemplatesService } from './notification-templates.service';
import {
  BODY_MD_MAX_LENGTH,
  TEXT_COLUMN_MAX_BYTES,
  UpdateNotificationTemplateDto,
} from './dto/update-notification-template.dto';

/**
 * Tres de las siete plantillas sembradas por la migración 015, suficientes
 * para cubrir CLIENT y TEAM y, dentro de TEAM, una activa y una desactivada
 * a propósito (id 7) para probar que `findActive` no la devuelve.
 */
const SEEDED: any[] = [
  {
    id: 1,
    triggerKey: 'TICKET_CREATED',
    audience: 'CLIENT',
    subject: '[{{codigo}}] Recibimos tu solicitud: {{asunto}}',
    bodyMd: 'Código {{codigo}}, estado {{estado}}, empresa {{razon_social}}, ' +
      'fecha {{fecha}}. Portal: {{enlace_portal}}.',
    isActive: 1,
    updatedBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    id: 6,
    triggerKey: 'TICKET_CREATED_PORTAL',
    audience: 'TEAM',
    subject: '[{{codigo}}] Ticket nuevo — {{razon_social}}',
    bodyMd: 'Prioridad {{prioridad}}, vence {{sla}}, responsable {{responsable}}. ' +
      'Panel: {{enlace_panel}}.',
    isActive: 1,
    updatedBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    id: 7,
    triggerKey: 'SLA_AT_RISK',
    audience: 'TEAM',
    subject: '[{{codigo}}] SLA en riesgo',
    bodyMd: 'Motivo: {{motivo}}. Panel: {{enlace_panel}}.',
    isActive: 0, // desactivada a propósito
    updatedBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  },
];

/**
 * Doble del repositorio. `findActive` replica la única pieza de lógica que
 * importa: filtrar por `isActive`, igual que hace el repositorio real contra
 * la base. Con un doble que ignorase eso, el test de "no devuelve una
 * plantilla desactivada" no probaría nada real.
 */
const makeService = () => {
  const almacen = SEEDED.map((t) => ({ ...t }));

  const repo = {
    findAll: jest.fn(() => Promise.resolve(almacen.slice())),
    findById: jest.fn((id: number) => Promise.resolve(almacen.find((t) => t.id === id) ?? null)),
    findActive: jest.fn((triggerKey: string, audience: string) =>
      Promise.resolve(
        almacen.find(
          (t) => t.triggerKey === triggerKey && t.audience === audience && t.isActive === 1,
        ) ?? null,
      ),
    ),
    update: jest.fn((id: number, data: any) => {
      const row = almacen.find((t) => t.id === id);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data);
      return Promise.resolve(row);
    }),
  };

  const email = {
    send: jest.fn((_input: { to: string; subject: string; html: string; text?: string }) =>
      Promise.resolve({ messageId: '<1@kuboti.com>', accepted: [], rejected: [] }),
    ),
  };

  const service = new NotificationTemplatesService(repo as any, email as any);
  return { service, repo, almacen, email };
};

describe('NotificationTemplatesService.update', () => {
  it('rechaza una variable de equipo en el cuerpo de una plantilla de cliente', async () => {
    const { service, repo } = makeService();
    const error = await service
      .update(1, 9, { bodyMd: 'Detalle interno: {{motivo}}' } as any)
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({ code: 'BAD_INPUT', message: expect.stringContaining('motivo') }),
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rechaza la misma variable de equipo si está en el asunto y el cuerpo es válido', async () => {
    const { service, repo } = makeService();
    const error = await service
      .update(1, 9, { subject: 'Prioridad: {{prioridad}}' } as any)
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        code: 'BAD_INPUT',
        message: expect.stringMatching(/asunto/i),
      }),
    );
    expect((error.getResponse() as any).message).toContain('prioridad');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('distingue en el mensaje una variable del otro público de una que no existe en ningún público', async () => {
    const { service } = makeService();
    const error = await service
      .update(1, 9, { bodyMd: 'Hola {{motivo}} y {{no_existe}}' } as any)
      .catch((e) => e);

    const { message } = error.getResponse() as { message: string };
    // "motivo" es de TEAM (fuga de datos); "no_existe" no es de ningún público (errata).
    // El texto tiene que explicarlos distinto, no con la misma frase.
    expect(message).toContain('motivo');
    expect(message).toContain('no_existe');
    const fragmentoMotivo = message.split('no_existe')[0];
    const fragmentoNoExiste = message.split('motivo')[1] ?? message;
    expect(fragmentoMotivo).not.toBe(fragmentoNoExiste);
    expect(message).toMatch(/públic/i); // habla del público para motivo
    expect(message).toMatch(/no existe/i); // y de "no existe" para la errata
  });

  it('el público no se puede cambiar aunque llegue en el cuerpo de la petición', async () => {
    const { service, almacen } = makeService();
    const updated = await service.update(1, 9, { subject: 'Asunto sin variables raras', audience: 'TEAM' } as any);

    expect(updated.audience).toBe('CLIENT');
    expect(almacen.find((t) => t.id === 1)!.audience).toBe('CLIENT');
  });

  it('el público declarado en la peticion no habilita variables de equipo: sigue validando con el público real de la plantilla', async () => {
    const { service, repo } = makeService();
    const error = await service
      .update(1, 9, { bodyMd: 'Detalle: {{motivo}}', audience: 'TEAM' } as any)
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('devuelve 404 si el id no existe', async () => {
    const { service } = makeService();
    const error = await service.update(999, 9, { subject: 'x' } as any).catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  /**
   * La carrera: la fila existe cuando se valida, alguien la borra, y la
   * relectura posterior al `UPDATE` devuelve `null`. Con el `!` de antes eso
   * era un `TypeError` leyendo propiedades de `undefined` en el controlador —
   * un 500 sin mensaje— en vez del 404 en español que el panel ya sabe
   * enseñar. Es la única mutación de la rama: merece fallar bien.
   */
  it('devuelve 404, no un error opaco, si la fila desaparece entre el UPDATE y la relectura', async () => {
    const { service, repo } = makeService();
    repo.update.mockResolvedValueOnce(null);

    const error = await service.update(1, 9, { subject: 'Asunto nuevo' } as any).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(error.getResponse().message).toMatch(/[áéíóúñ¿]|no encontrada/i);
  });

  it('graba quien la editó en updatedBy, tomado de la sesión y no del cuerpo', async () => {
    const { service, almacen } = makeService();
    await service.update(1, 42, { subject: 'Asunto nuevo sin variables raras' } as any);
    expect(almacen.find((t) => t.id === 1)!.updatedBy).toBe(42);
  });

  it('una edición válida en una plantilla de equipo sí permite variables de equipo', async () => {
    const { service } = makeService();
    const updated = await service.update(6, 9, { bodyMd: 'Motivo operativo: {{motivo}}' } as any);
    expect(updated.bodyMd).toContain('{{motivo}}');
  });

  it('sin subject ni bodyMd en el dto solo cambia isActive y no toca los textos', async () => {
    const { service, almacen } = makeService();
    const before = almacen.find((t) => t.id === 1)!.subject;
    await service.update(1, 9, { isActive: false } as any);
    const row = almacen.find((t) => t.id === 1)!;
    expect(row.subject).toBe(before);
    expect(row.isActive).toBe(0);
  });
});

describe('NotificationTemplatesService.findActive', () => {
  it('devuelve la plantilla activa para su clave y público', async () => {
    const { service } = makeService();
    const found = await service.findActive('TICKET_CREATED_PORTAL', 'TEAM');
    expect(found?.id).toBe(6);
  });

  it('no devuelve una plantilla desactivada', async () => {
    const { service } = makeService();
    const found = await service.findActive('SLA_AT_RISK', 'TEAM');
    expect(found).toBeNull();
  });

  it('no devuelve nada si la clave o el público no existen', async () => {
    const { service } = makeService();
    const found = await service.findActive('NO_EXISTE', 'CLIENT');
    expect(found).toBeNull();
  });
});

describe('NotificationTemplatesService.list', () => {
  it('devuelve todas las plantillas, activas e inactivas', async () => {
    const { service } = makeService();
    const rows = await service.list();
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.isActive === 0)).toBe(true);
  });
});

describe('NotificationTemplatesService.preview', () => {
  it('compone el asunto y el cuerpo con datos de ejemplo, por el mismo camino que el envío real, sin enviar nada', async () => {
    const { service, email } = makeService();
    const preview = await service.preview(1); // CLIENT: TICKET_CREATED

    expect(preview.subject).toContain('Recibimos tu solicitud');
    expect(preview.subject).not.toContain('{{'); // ninguna variable sin sustituir
    expect(preview.text).not.toContain('{{');
    expect(preview.html).not.toContain('(no disponible)'); // los datos de ejemplo cubren las 6 variables
    expect(email.send).not.toHaveBeenCalled();
  });

  it('la plantilla de equipo se previsualiza con sus cinco variables adicionales, también sin enviar nada', async () => {
    const { service, email } = makeService();
    const preview = await service.preview(6); // TEAM: TICKET_CREATED_PORTAL

    expect(preview.html).not.toContain('(no disponible)');
    expect(preview.html).not.toContain('{{');
    expect(email.send).not.toHaveBeenCalled();
  });

  it('404 si la plantilla no existe, y tampoco llama a EmailService.send', async () => {
    const { service, email } = makeService();
    const error = await service.preview(999).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(email.send).not.toHaveBeenCalled();
  });
});

describe('NotificationTemplatesService.sendTest', () => {
  it('envía el correo de ejemplo exactamente al destinatario que recibe como parámetro', async () => {
    const { service, email } = makeService();
    const result = await service.sendTest(1, 'admin@kubo.pe');

    expect(email.send).toHaveBeenCalledTimes(1);
    const [enviado] = email.send.mock.calls[0];
    expect(enviado.to).toBe('admin@kubo.pe');
    expect(enviado.subject).toContain('Recibimos tu solicitud');
    expect(result).toEqual({ to: 'admin@kubo.pe' });
  });

  it('nunca envía a una dirección distinta de la recibida por parámetro, aunque la plantilla no tenga destinatario propio', async () => {
    // sendTest no resuelve ningún destinatario de negocio (autor del ticket,
    // buzón del equipo...): el único "to" posible es el que decide quien
    // llama -- el controlador, con el correo del token. Esta prueba fija que
    // la función no tiene ningún otro camino para elegir destinatario.
    const { service, email } = makeService();
    await service.sendTest(6, 'otro.admin@kubo.pe');

    expect(email.send.mock.calls[0][0].to).toBe('otro.admin@kubo.pe');
  });

  it('404 si la plantilla no existe: no llega a llamar a EmailService.send', async () => {
    const { service, email } = makeService();
    const error = await service.sendTest(999, 'admin@kubo.pe').catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(email.send).not.toHaveBeenCalled();
  });
});

describe('el dto de actualización', () => {
  it('no admite audience: con forbidNonWhitelisted (config real del ValidationPipe) lo rechaza', async () => {
    const instancia = plainToInstance(UpdateNotificationTemplateDto, {
      subject: 'x',
      audience: 'TEAM',
    });
    const errores = await validate(instancia, { whitelist: true, forbidNonWhitelisted: true });
    expect(errores.some((e) => e.property === 'audience')).toBe(true);
  });

  it('acepta una edición mínima sin ningún campo', async () => {
    const instancia = plainToInstance(UpdateNotificationTemplateDto, {});
    const errores = await validate(instancia, { whitelist: true, forbidNonWhitelisted: true });
    expect(errores).toEqual([]);
  });

  /**
   * `subject` ya tenía tope, casando con su `VARCHAR(300)`. `bodyMd` no tenía
   * ninguno, y su columna es un `TEXT`: 65 535 **bytes**. Con MySQL en
   * `STRICT_TRANS_TABLES` pasarse no trunca, aborta, así que un cuerpo enorme
   * salía como un 500 crudo en vez del 400 en español que el editor del panel
   * sabe enseñar.
   */
  describe('el tope del cuerpo', () => {
    const validarBody = (bodyMd: string) =>
      validate(plainToInstance(UpdateNotificationTemplateDto, { bodyMd }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

    it('rechaza un cuerpo que no cabría en la columna, y lo dice en español', async () => {
      const errores = await validarBody('x'.repeat(BODY_MD_MAX_LENGTH + 1));

      expect(errores).toHaveLength(1);
      expect(Object.values(errores[0].constraints ?? {}).join(' ')).toMatch(/cuerpo|caracteres/i);
    });

    it('acepta uno justo en el tope', async () => {
      expect(await validarBody('x'.repeat(BODY_MD_MAX_LENGTH))).toEqual([]);
    });

    /**
     * El tope se cuenta en caracteres y la columna en bytes. En `utf8mb4` un
     * carácter puede ocupar hasta tres bytes por unidad de las que cuenta
     * `MaxLength`, así que el tope tiene que dejar sitio para el peor caso: si
     * no, un cuerpo lleno de acentos pasaría la validación y reventaría el
     * `UPDATE` igual que antes.
     */
    it('el tope deja sitio al peor caso en bytes de utf8mb4', () => {
      expect(BODY_MD_MAX_LENGTH * 3).toBeLessThan(TEXT_COLUMN_MAX_BYTES);
    });
  });
});
