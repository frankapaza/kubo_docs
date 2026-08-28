import { ConfigService } from '@nestjs/config';

import { buildInvitationEmail, buildInvitationUrl, resolveFrontendUrl } from './invitation-email';

const cfg = (valor?: string) =>
  ({ get: (k: string, fallback?: string) => (k === 'FRONTEND_URL' ? valor : fallback) }) as
    unknown as ConfigService;

describe('la dirección del enlace', () => {
  it('cuelga de la ruta pública de aceptar invitación', () => {
    expect(buildInvitationUrl('https://kuboti.com', 'SECRETO')).toBe(
      'https://kuboti.com/portal/invitacion/SECRETO',
    );
  });

  it('no duplica la barra si la base ya la trae', () => {
    expect(buildInvitationUrl('https://kuboti.com/', 'SECRETO')).toBe(
      'https://kuboti.com/portal/invitacion/SECRETO',
    );
  });

  /**
   * `||` y no `??`. `docker-compose.yml` declara `FRONTEND_URL: ${FRONTEND_URL}`
   * y Compose SUSTITUYE POR CADENA VACÍA cuando la variable no está en el
   * `.env`: no omite la clave. Con `??`, ese vacío pasaría por "configurado" y
   * el enlace saldría como `/portal/invitacion/<secreto>`, sin host —
   * irreparable para quien lo recibe. Mismo criterio que `resolveFrontendUrl`
   * en el despachador de avisos y que el envío de firmas.
   */
  it.each([[undefined], [''], ['   ']])(
    'una FRONTEND_URL ausente o en blanco (%s) cae al valor por defecto, no deja el enlace sin host',
    (valor) => {
      expect(resolveFrontendUrl(cfg(valor))).toBe('http://localhost:5173');
    },
  );

  it('recorta las barras finales de la base configurada', () => {
    expect(resolveFrontendUrl(cfg('https://kuboti.com//'))).toBe('https://kuboti.com');
  });
});

describe('el correo de invitación', () => {
  const base = {
    fullName: 'Ana Pérez',
    clientName: 'Acme S.A.C.',
    acceptUrl: 'https://kuboti.com/portal/invitacion/SECRETO',
    expiresAt: new Date('2026-09-02T15:00:00.000Z'),
  };

  it('lleva el enlace en el cuerpo, en las dos versiones', () => {
    const { html, text } = buildInvitationEmail(base);
    expect(html).toContain(base.acceptUrl);
    expect(text).toContain(base.acceptUrl);
  });

  it('siempre hay versión de texto: un cliente que no pinte HTML tiene que ver el enlace', () => {
    expect(buildInvitationEmail(base).text.trim().length).toBeGreaterThan(0);
  });

  it('nombra a la persona y a su empresa', () => {
    const { html } = buildInvitationEmail(base);
    expect(html).toContain('Ana Pérez');
    expect(html).toContain('Acme S.A.C.');
  });

  it('si no se pudo resolver la empresa, el correo sale igual y sin huecos raros', () => {
    const { html, subject } = buildInvitationEmail({ ...base, clientName: null });
    expect(html).not.toContain('null');
    expect(subject).not.toContain('null');
  });

  /**
   * Riesgo 1 de la spec: el correo acaba en spam. Se evita el vocabulario que
   * disparan los filtros — nada de "gratis", "urgente", "haz clic aquí ahora",
   * ni asuntos en mayúsculas o con signos de exclamación.
   */
  it('el asunto no usa el vocabulario que disparan los filtros de spam', () => {
    const { subject } = buildInvitationEmail(base);
    expect(subject).not.toMatch(/!|gratis|urgente|haz clic|oferta/i);
    expect(subject).not.toBe(subject.toUpperCase());
  });

  /**
   * El nombre de la persona invitada y la razón social los TECLEA alguien: el
   * primero lo escribe un administrador de cliente en el formulario de
   * invitar, la segunda el personal al dar de alta la empresa. Sin escapar,
   * un `<script>` sale como etiqueta viva dentro del correo del invitado.
   *
   * Se usa el mismo `escapeHtml` del renderizador de plantillas de avisos que
   * ya cierra esto en los correos de tickets.
   *
   * Lo que NO es: esto no escala a inyección de cabeceras del sobre. Los
   * saltos de línea de estos valores no llegan a ninguna cabecera —van al
   * cuerpo, y nodemailer pliega los saltos de `subject` en vez de dejar
   * abrir una cabecera nueva—. El riesgo se queda en el cuerpo, y ahí es
   * donde se cierra. El `From:` incrustado del caso de abajo comprueba
   * justamente que se queda en texto inofensivo.
   */
  describe('lo que teclea una persona no se interpreta como marcado', () => {
    const hostiles: Array<[string, string]> = [
      ['una etiqueta', 'Ana<script>alert(1)</script>'],
      ['un salto de línea', 'Ana\nBcc: espia@ejemplo.pe'],
      ['una cabecera From: incrustada', 'Ana\r\nFrom: suplantador@ejemplo.pe'],
      ['un atributo con comillas', 'Ana" onmouseover="alert(1)'],
    ];

    it.each(hostiles)('el nombre de la persona con %s sale escapado', (_d, nombre) => {
      const { html } = buildInvitationEmail({ ...base, fullName: nombre });
      expect(html).not.toContain('<script>');
      expect(html).toContain(
        nombre
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;'),
      );
    });

    it.each(hostiles)('la razón social con %s sale escapada', (_d, razon) => {
      const { html } = buildInvitationEmail({ ...base, clientName: razon });
      expect(html).not.toContain('<script>');
      expect(html).not.toMatch(/<[a-z]+ [^>]*onmouseover/i);
      expect(html).toContain(razon.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
    });

    /**
     * Ni el asunto ni la versión de texto se escapan: ahí no hay marcado que
     * interpretar y un `&amp;` literal sería una errata visible para quien
     * lee. La regla vive en el HTML, que es donde está el riesgo.
     */
    it('el asunto y la versión de texto no llevan entidades HTML', () => {
      const { subject, text } = buildInvitationEmail({
        ...base,
        fullName: 'Ana & Luis',
        clientName: 'Peña & Hijos S.A.C.',
      });
      expect(subject).toContain('Peña & Hijos S.A.C.');
      expect(subject).not.toContain('&amp;');
      expect(text).toContain('Ana & Luis');
      expect(text).not.toContain('&amp;');
    });
  });

  it('dice hasta cuándo sirve el enlace, en hora de Lima', () => {
    // 15:00 UTC del 2 de septiembre son las 10:00 del mismo día en Lima.
    //
    // «setiembre», con una sola «p», y NO «septiembre»: no es una errata de
    // esta prueba. Es la forma que CLDR asigna al locale `es-PE` para el mes
    // —la que de verdad ve un cliente peruano— y coincide con lo que ya
    // devuelve `toLocaleDateString('es-PE', ...)` en el resto del proyecto
    // (`document-signatories.service.ts`, `documents.service.ts`,
    // `reports.service.ts`, `ticket-ai.service.ts`); esta es solo la primera
    // prueba del repositorio que fija el nombre de un mes por escrito. Quien
    // vea "setiembre" dentro de seis meses y lo tome por un error de tipeo:
    // no lo es, no lo "arregles" a "septiembre".
    expect(buildInvitationEmail(base).html).toContain('2 de setiembre');
  });
});
