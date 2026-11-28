import { composeEmail } from './email-compose';

/**
 * `composeEmail` es el único camino de composición del módulo: lo usan tanto
 * `NotificationDispatcher` (envío real) como `NotificationTemplatesService`
 * (`preview` / `sendTest`). Estas pruebas fijan su contrato en aislamiento,
 * sin base de datos ni `EmailService` de por medio.
 */
describe('composeEmail', () => {
  const template = {
    subject: '[{{codigo}}] {{asunto}}',
    bodyMd: 'Hola,\n\nTu ticket **{{codigo}}** está en {{estado}}.\n\n' +
      '- **Empresa:** {{razon_social}}\n\nPortal: {{enlace_portal}}',
  };

  const values = {
    codigo: 'TKT-0001',
    asunto: 'No carga la caja',
    estado: 'En atención',
    razon_social: "Empresa & Cía. <la 'buena'>",
    enlace_portal: 'https://portal.ejemplo.pe/tickets/1',
  };

  it('sustituye las variables del asunto y el cuerpo', () => {
    const correo = composeEmail(template, 'CLIENT', values);
    expect(correo.subject).toBe('[TKT-0001] No carga la caja');
    expect(correo.text).toContain('TKT-0001');
    expect(correo.text).toContain('En atención');
  });

  it('el asunto y el texto plano no llevan entidades HTML: no son HTML', () => {
    const correo = composeEmail(template, 'CLIENT', values);
    // El valor sustituido tenía '&', '<' y comillas: en subject/text deben
    // volver literales, no como &amp;/&lt;/&quot;.
    expect(correo.subject).not.toContain('&amp;');
    expect(correo.text).toContain("Empresa & Cía. <la 'buena'>");
    expect(correo.text).not.toContain('&amp;');
    expect(correo.text).not.toContain('&lt;');
  });

  it('el html sí lleva marcado -- negrita, viñeta y párrafos -- y conserva el escapado de render', () => {
    const correo = composeEmail(template, 'CLIENT', values);
    expect(correo.html).toContain('<strong>TKT-0001</strong>');
    // La lista «- **Etiqueta:** valor» sale como ficha de datos (etiqueta | valor).
    expect(correo.html).toContain('>Empresa<');
    expect(correo.html).toContain('&amp;'); // el '&' del valor, escapado en el html
  });

  it('no incluye ningún destinatario: eso lo añade quien llama, no esta función', () => {
    const correo = composeEmail(template, 'CLIENT', values) as unknown as Record<string, unknown>;
    expect(correo.to).toBeUndefined();
  });
});

describe('composeEmail: contenido con diseño (spec 2026-11-28-correos-html)', () => {
  const PORTAL = 'https://docs.kuboti.com/portal/tickets/7';
  const values = { codigo: 'KB-0007', asunto: 'No carga la caja', estado: 'Esperando tu respuesta', razon_social: 'ACME', enlace_portal: PORTAL };
  const body =
    'Hola,\n\nTu ticket **{{codigo}}** quedó en espera.\n\n' +
    '- **Asunto:** {{asunto}}\n- **Estado:** {{estado}}\n\n' +
    'Puedes seguir el avance desde el portal cuando quieras:\n{{enlace_portal}}\n\n' +
    'Este correo es automático y **no se puede responder**. Entra al portal.';
  const t = (triggerKey: string) => ({ subject: '[{{codigo}}] {{asunto}}', bodyMd: body, triggerKey });

  it('al cliente que debe contestar: recuadro resaltado con botón «Responder en el ticket» al portal', () => {
    const { html } = composeEmail(t('TICKET_WAITING_CLIENT'), 'CLIENT', values);
    expect(html).toContain('Necesitamos tu respuesta');
    expect(html).toContain(`href="${PORTAL}"`);
    expect(html).toContain('>Responder en el ticket<');
    expect(html).toContain('border-left:4px solid #053777');
  });

  it('respuesta del equipo: invita a leer y contestar en el ticket', () => {
    const { html } = composeEmail(t('TICKET_MESSAGE_FROM_TEAM'), 'CLIENT', values);
    expect(html).toContain('Tienes una respuesta nueva');
    expect(html).toContain('>Responder en el ticket<');
  });

  it('el enlace suelto del portal no se repite: lo lleva el botón; la frase que lo presentaba no queda colgando', () => {
    const { html } = composeEmail(t('TICKET_WAITING_CLIENT'), 'CLIENT', values);
    expect(html.split(PORTAL).length - 1).toBe(1);
    expect(html).toContain('desde el portal cuando quieras.');
    expect(html).not.toContain('cuando quieras:');
  });

  it('cabecera con el código y el estado, y ficha de datos con etiqueta y valor', () => {
    const { html } = composeEmail(t('TICKET_CREATED'), 'CLIENT', values);
    expect(html).toContain('>KB-0007<');
    expect(html).toContain('>Esperando tu respuesta<');
    expect(html).toMatch(/>Asunto<\/td>\s*<td[^>]*>No carga la caja</);
  });

  it('el aviso de «no se puede responder» va en letra pequeña', () => {
    const { html } = composeEmail(t('TICKET_CREATED'), 'CLIENT', values);
    expect(html).toMatch(/font-size:12px[^>]*>Este correo es automático/);
  });

  it('una línea con URL y texto sigue como enlace normal; una URL suelta distinta pasa a botón', () => {
    const { html } = composeEmail(
      { subject: 's', bodyMd: 'Mira https://x.pe/a hoy\n\nhttps://x.pe/b', triggerKey: 'TICKET_CREATED' },
      'CLIENT',
      {},
    );
    expect(html).toContain('<a href="https://x.pe/a">https://x.pe/a</a> hoy');
    expect(html).toContain('>Abrir enlace<');
  });

  it('al equipo: botón «Abrir en el panel», sin recuadro de responder al cliente', () => {
    const { html } = composeEmail(
      { subject: 's', bodyMd: 'El cliente escribió en {{codigo}}.', triggerKey: 'TICKET_MESSAGE_FROM_CLIENT' },
      'TEAM',
      { codigo: 'KB-0007', enlace_panel: 'https://docs.kuboti.com/tickets/7' },
    );
    expect(html).toContain('>Abrir en el panel<');
    expect(html).not.toContain('Responder en el ticket');
  });

  it('el texto plano no cambia', () => {
    const { text } = composeEmail(t('TICKET_WAITING_CLIENT'), 'CLIENT', values);
    expect(text).toContain('cuando quieras:\n' + PORTAL);
    expect(text).not.toContain('Responder en el ticket');
  });
});


describe('composeEmail: pie en letra pequeña y enlaces con & (revisión final)', () => {
  it('el pie de las plantillas de conversación (018) también va en letra pequeña y al final', () => {
    const { html } = composeEmail(
      {
        subject: 's',
        bodyMd: 'Hola.\n\nEste correo es automático. Si respondes, tu respuesta llega a un buzón que\nleemos, pero **no se registra en el ticket**.\n\n{{enlace_portal}}',
        triggerKey: 'TICKET_MESSAGE_FROM_TEAM',
      },
      'CLIENT',
      { codigo: 'KB-1', enlace_portal: 'https://docs.kuboti.com/portal/tickets/1' },
    );
    expect(html).toMatch(/font-size:12px[^>]*>Este correo es automático\. Si respondes/);
    expect(html.indexOf('Este correo es automático')).toBeGreaterThan(html.indexOf('Responder en el ticket'));
  });

  it('un valor del cliente que dice «no se puede responder» no se encoge ni se mueve', () => {
    const { html } = composeEmail({ subject: 's', bodyMd: 'Asunto: {{asunto}}', triggerKey: 'TICKET_CREATED' }, 'CLIENT', {
      asunto: 'el sistema no se puede responder',
    });
    expect(html).not.toContain('font-size:12px;line-height:1.5;color:#7a8794');
  });

  it('un enlace del portal con & se quita igual de la línea suelta y va solo en el botón', () => {
    const url = 'https://docs.kuboti.com/portal/tickets/1?a=1&b=2';
    const { html } = composeEmail({ subject: 's', bodyMd: 'Míralo aquí:\n{{enlace_portal}}', triggerKey: 'TICKET_CREATED' }, 'CLIENT', {
      enlace_portal: url,
    });
    expect(html.split('tickets/1?a=1&amp;b=2').length - 1).toBe(1);
    expect(html).toContain('Míralo aquí.');
  });

  it('sin enlace del portal no hay recuadro de acción', () => {
    const { html } = composeEmail({ subject: 's', bodyMd: 'Hola.', triggerKey: 'TICKET_CREATED' }, 'CLIENT', {});
    expect(html).not.toContain('border-left:4px solid #053777');
  });
});
