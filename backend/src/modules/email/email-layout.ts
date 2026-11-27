import { KUBO_LOGO_PNG_BASE64 } from './kubo-logo';

/**
 * Marco común de todos los correos de DevDocs: logo KUBO, azul de kuboti.com y
 * pie. Lo aplica `EmailService.send` a cualquier `html` (spec
 * 2026-11-28-correos-html). Solo tablas y estilos en línea: Outlook ignora casi
 * todo lo demás.
 */

export const KUBO_BLUE = '#053777';
export const KUBO_BLUE_DARK = '#012660';
export const KUBO_LOGO_CID = 'kubo-logo@kuboti.com';
const MARK = '<!--kubo-layout-->';
const FOOTER = 'Kubo Soluciones Tecnológicas · kuboti.com · Este correo es automático.';

export function escapeEmailHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function kuboLogoDataUri(): string {
  return `data:image/png;base64,${KUBO_LOGO_PNG_BASE64}`;
}

export function kuboLogoAttachment(): { filename: string; content: Buffer; contentType: string; cid: string } {
  return { filename: 'kubo.png', content: Buffer.from(KUBO_LOGO_PNG_BASE64, 'base64'), contentType: 'image/png', cid: KUBO_LOGO_CID };
}

/** Botón azul (tabla, para Outlook). Vacío si el enlace no es http(s). */
export function emailButton(href: string, label: string): string {
  const url = String(href ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr>` +
    `<td style="border-radius:8px;background:${KUBO_BLUE};padding:12px 24px">` +
    `<a href="${escapeEmailHtml(url)}" target="_blank" style="display:inline-block;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeEmailHtml(label)}</a>` +
    `</td></tr></table>`
  );
}

/**
 * Recuadro resaltado con una llamada a la acción (p. ej. «¿Quieres responder?»
 * + botón que abre el ticket). `titleHtml`/`bodyHtml` ya vienen seguros.
 */
export function emailCallout(titleHtml: string, bodyHtml: string, button?: { href: string; label: string }): string {
  const btn = button ? emailButton(button.href, button.label) : '';
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;background:#eef3fb;border-left:4px solid ${KUBO_BLUE};border-radius:8px"><tr>` +
    `<td style="padding:16px 18px">` +
    `<p style="margin:0 0 6px;font-size:15px;font-weight:700;color:${KUBO_BLUE_DARK}">${titleHtml}</p>` +
    `<p style="margin:0;font-size:14px;line-height:1.55;color:#33414d">${bodyHtml}</p>` +
    btn.replace('margin:18px 0', 'margin:14px 0 2px') +
    `</td></tr></table>`
  );
}

export function wrapEmailLayout(contentHtml: string, opts: { logoSrc: string }): string {
  if (contentHtml.includes(MARK)) return contentHtml;
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>${MARK}</head>
<body style="margin:0;padding:0;background:#f2f5f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f9;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e8ef">
<tr><td style="padding:22px 28px 18px;border-bottom:3px solid ${KUBO_BLUE}">
<img src="${escapeEmailHtml(opts.logoSrc)}" alt="KUBO" width="150" height="45" style="display:block;border:0;outline:none;width:150px;height:auto"/>
</td></tr>
<tr><td style="padding:26px 28px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#22272a">
${contentHtml}
</td></tr>
<tr><td style="padding:14px 28px;background:#f7f9fc;border-top:1px solid #e3e8ef;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#7a8794">
${FOOTER}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
