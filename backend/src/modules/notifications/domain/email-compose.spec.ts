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
    expect(correo.html).toContain('<li>');
    expect(correo.html).toContain('&amp;'); // el '&' del valor, escapado en el html
  });

  it('no incluye ningún destinatario: eso lo añade quien llama, no esta función', () => {
    const correo = composeEmail(template, 'CLIENT', values) as unknown as Record<string, unknown>;
    expect(correo.to).toBeUndefined();
  });
});
