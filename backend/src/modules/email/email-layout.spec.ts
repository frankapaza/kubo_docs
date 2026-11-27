import { KUBO_LOGO_CID, emailButton, kuboLogoDataUri, wrapEmailLayout } from './email-layout';

describe('wrapEmailLayout: marco común de los correos', () => {
  const html = wrapEmailLayout('<p>Hola Ana:</p>', { logoSrc: `cid:${KUBO_LOGO_CID}` });

  it('arma un documento completo con el logo, el azul de marca, el contenido y el pie', () => {
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain(`src="cid:${KUBO_LOGO_CID}"`);
    expect(html).toContain('alt="KUBO"');
    expect(html).toContain('#053777');
    expect(html).toContain('<p>Hola Ana:</p>');
    expect(html).toContain('Kubo Soluciones Tecnológicas · kuboti.com · Este correo es automático.');
    expect(html).toContain('max-width:600px');
  });

  it('no envuelve dos veces lo que ya trae el marco', () => {
    expect(wrapEmailLayout(html, { logoSrc: 'cid:otro' })).toBe(html);
  });

  it('el logo como data: URI sirve para la vista previa', () => {
    expect(kuboLogoDataUri()).toMatch(/^data:image\/png;base64,iVBOR/);
  });
});

describe('emailButton', () => {
  it('botón azul con la etiqueta y el enlace', () => {
    const b = emailButton('https://docs.kuboti.com/portal/tickets/1', 'Ver en el portal');
    expect(b).toContain('href="https://docs.kuboti.com/portal/tickets/1"');
    expect(b).toContain('>Ver en el portal<');
    expect(b).toContain('#053777');
  });

  it('escapa la etiqueta y el enlace', () => {
    const b = emailButton('https://x.pe/?a="b"&c=<d>', '<b>Ir</b>');
    expect(b).toContain('href="https://x.pe/?a=&quot;b&quot;&amp;c=&lt;d&gt;"');
    expect(b).toContain('&lt;b&gt;Ir&lt;/b&gt;');
  });

  it('solo http(s): nada de javascript: ni rutas raras', () => {
    expect(emailButton('javascript:alert(1)', 'x')).toBe('');
    expect(emailButton('  ', 'x')).toBe('');
  });
});

describe('Outlook de escritorio (revisión final)', () => {
  it('la tarjeta tiene ancho fijo de 600 para Outlook, además del max-width', () => {
    const html = wrapEmailLayout('<p>x</p>', { logoSrc: 'cid:x' });
    expect(html).toMatch(/<table[^>]*width="600"[^>]*style="[^"]*max-width:600px/);
  });

  it('el botón lleva el relleno en la celda, no solo en el enlace', () => {
    expect(emailButton('https://x.pe', 'Ir')).toMatch(/<td[^>]*style="[^"]*padding:12px 24px/);
  });
});
