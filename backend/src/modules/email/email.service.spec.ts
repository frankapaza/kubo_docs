import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

import { EmailService } from './email.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const createTransport = nodemailer.createTransport as unknown as jest.Mock;

/**
 * Las `SMTP_*` del `.env` como respaldo de la configuración por panel.
 *
 * Lo que se prueba aquí no es el envío —eso lo hace nodemailer— sino cómo se
 * leen esas variables cuando llegan **vacías**, que es como llegan siempre que
 * no estén puestas: `docker-compose.yml` inyecta `SMTP_HOST: ${SMTP_HOST}` y
 * Compose **sustituye por cadena vacía**, no omite la clave. Con `??`, esa
 * cadena vacía pasa por "configurado": el puerto sale `NaN` y el `From`
 * vacío. Es el mismo escenario que ya documenta `resolveFrontendUrl` en el
 * despachador de avisos, y ahora es real aquí porque el compose de producción
 * declara estas variables.
 */
function montar(env: Record<string, string | undefined>, smtpDeLaBase: unknown = null) {
  const config = {
    get: jest.fn((key: string, porDefecto?: string) =>
      key in env ? env[key] : porDefecto,
    ),
  };
  const workspace = { getSmtpConfig: jest.fn(() => Promise.resolve(smtpDeLaBase)) };
  const service = new EmailService(config as any, workspace as any);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return service;
}

/** Lo que se le pasó a `nodemailer.createTransport`. */
function transporte(): any {
  return createTransport.mock.calls[0][0];
}

/** Lo que se le pasó a `sendMail`. */
function correo(): any {
  return createTransport.mock.results[0].value.sendMail.mock.calls[0][0];
}

const UN_CORREO = {
  to: 'cliente@empresa.com',
  subject: 'Prueba',
  html: '<p>hola</p>',
};

describe('EmailService: el respaldo por variables de entorno', () => {
  beforeEach(() => {
    createTransport.mockReset();
    createTransport.mockReturnValue({
      sendMail: jest.fn().mockResolvedValue({
        messageId: '<1@kuboti.com>',
        accepted: ['cliente@empresa.com'],
        rejected: [],
      }),
    });
  });

  afterEach(() => jest.restoreAllMocks());

  /**
   * El caso del stack de producción sin `.env` completo. Tiene que fallar
   * diciendo que no está configurado, no intentar conectarse a un host vacío.
   */
  it('unas SMTP_* vacías cuentan como ausentes, no como configuración', async () => {
    const service = montar({ SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', SMTP_PORT: '' });

    await expect(service.send(UN_CORREO)).rejects.toMatchObject({
      response: { code: 'EMAIL_NOT_CONFIGURED' },
    });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('un SMTP_PORT vacío cae a 587, no a NaN', async () => {
    const service = montar({
      SMTP_HOST: 'mail.kuboti.com',
      SMTP_USER: 'ticket@kuboti.com',
      SMTP_PASS: 'secreto',
      SMTP_PORT: '',
      SMTP_SECURE: '',
    });

    await service.send(UN_CORREO);

    expect(transporte().port).toBe(587);
    expect(transporte().secure).toBe(false);
  });

  it('un SMTP_FROM vacío cae al usuario, no a un remitente en blanco', async () => {
    const service = montar({
      SMTP_HOST: 'mail.kuboti.com',
      SMTP_USER: 'ticket@kuboti.com',
      SMTP_PASS: 'secreto',
      SMTP_FROM: '',
    });

    await service.send(UN_CORREO);

    expect(correo().from).toBe('ticket@kuboti.com');
  });

  it('la configuración de la base sigue ganando a las variables', async () => {
    const service = montar(
      { SMTP_HOST: 'mail.otro.com', SMTP_USER: 'otro@otro.com', SMTP_PASS: 'x' },
      {
        host: 'mail.kuboti.com',
        port: 465,
        secure: true,
        user: 'ticket@kuboti.com',
        pass: 'secreto',
        from: 'ticket@kuboti.com',
      },
    );

    await service.send(UN_CORREO);

    expect(transporte().host).toBe('mail.kuboti.com');
  });
});
