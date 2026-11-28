/**
 * Composición pura de un correo de aviso, sin efectos: dado el texto de una
 * plantilla y los valores a sustituir, arma las tres partes que espera
 * `EmailService.send` (`subject`, `html`, `text`). Dominio puro, como
 * `template-renderer.ts`: sin inyección de dependencias, sin base de datos.
 *
 * Es el **único** camino de composición del módulo. Lo usan tanto
 * `NotificationDispatcher.dispatchOne` (para el envío real, que le añade el
 * `to` que haya resuelto) como `NotificationTemplatesService.preview` y
 * `.sendTest` (con datos de ejemplo, en vez de los de un ticket real). Si la
 * previsualización compusiera el correo por su cuenta -- en vez de llamar a
 * esta misma función --, dejaría de servir para lo único que promete: enseñar
 * cómo va a quedar el correo que de verdad se manda.
 */

import { KUBO_BLUE, KUBO_BLUE_DARK, emailButton, emailCallout, escapeEmailHtml } from '../../email/email-layout';
import { NotificationAudience, TemplateValues, escapeHtml, render } from './template-renderer';

/** Lo mínimo de una plantilla que hace falta para componer un correo. */
export interface ComposableTemplate {
  subject: string;
  bodyMd: string;
  /** Qué aviso es: decide el recuadro de acción (p. ej. «Responder en el ticket»). */
  triggerKey?: string;
}

/** Un correo compuesto, listo para `EmailService.send` salvo por el destinatario. */
export interface ComposedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Deshace exactamente los cinco escapes que aplica `render` a los valores
 * sustituidos, y ninguno más.
 *
 * Hace falta porque `render` escapa siempre --está pensado para el cuerpo
 * HTML--, pero el asunto de un correo y su parte `text/plain` no son HTML: ahí
 * un apóstrofo del asunto del ticket se leería literalmente como `&#39;`. El
 * `&amp;` va el último a propósito: al revés, `&amp;lt;` acabaría convertido
 * en `<`, que es justo la reinyección que el escapado evita.
 */
function undoHtmlEscaping(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Marcado de línea del cuerpo: la columna se llama `body_md` y las plantillas
 * sembradas usan negritas y viñetas. Sin esto el cliente leería
 * `- **Código:** TKT-0013` con los asteriscos a la vista.
 *
 * Es un subconjunto mínimo y deliberado --negrita, viñeta, enlace--, no un
 * intérprete de Markdown: cuanto menos transforme, menos formas hay de que el
 * contenido escrito por el cliente acabe significando algo.
 */
function inlineMarkup(line: string): string {
  return (
    line
      // Los enlaces van solos en su línea en las plantillas sembradas. Se corta
      // en `<` para no tragarse las etiquetas que esta misma función genera, y
      // en `*` porque la negrita se sustituye **después**: sin excluirlo, una
      // URL con asteriscos acabaría con un `<strong>` metido dentro del `href`
      // y el enlace no abriría. No es inyección --las comillas ya llegan como
      // entidades-- pero sí un enlace roto.
      .replace(/\bhttps?:\/\/[^\s<*]+/g, (url) => `<a href="${url}">${url}</a>`)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  );
}

/** Llamada a la acción del aviso: el recuadro y su botón (spec 2026-11-28-correos-html). */
interface EmailAction {
  url: string;
  label: string;
  /** Sin título: solo el botón (avisos al equipo). */
  title?: string;
  body?: string;
}

const CLIENT_ACTIONS: Record<string, { title: string; body: string; label: string }> = {
  TICKET_WAITING_CLIENT: {
    title: 'Necesitamos tu respuesta',
    body: 'Tu ticket queda en espera hasta que nos contestes. Escríbenos desde el ticket: así queda registrado y lo ve todo el equipo.',
    label: 'Responder en el ticket',
  },
  TICKET_MESSAGE_FROM_TEAM: {
    title: 'Tienes una respuesta nueva',
    body: 'Léela en el ticket y contéstanos ahí mismo si necesitas algo más.',
    label: 'Responder en el ticket',
  },
  TICKET_RESOLVED: {
    title: '¿Quedó resuelto?',
    body: 'Si algo sigue fallando, respóndenos en el ticket y lo revisamos.',
    label: 'Responder en el ticket',
  },
  TICKET_CLOSED: {
    title: '¿Necesitas algo más?',
    body: 'Puedes revisar el historial completo del ticket en el portal.',
    label: 'Ver el ticket',
  },
};
const CLIENT_DEFAULT_ACTION = {
  title: '¿Quieres agregar algo?',
  body: 'Escríbelo en el ticket desde el portal: así queda registrado y lo ve todo el equipo.',
  label: 'Abrir el ticket',
};

function actionFor(audience: NotificationAudience, triggerKey: string | undefined, values: TemplateValues): EmailAction | null {
  const portal = String(values.enlace_portal ?? '').trim();
  const panel = String(values.enlace_panel ?? '').trim();
  if (audience === 'CLIENT') {
    if (!/^https?:\/\//i.test(portal)) return null;
    const a = (triggerKey && CLIENT_ACTIONS[triggerKey]) || CLIENT_DEFAULT_ACTION;
    return { url: portal, ...a };
  }
  if (!/^https?:\/\//i.test(panel)) return null;
  return { url: panel, label: 'Abrir en el panel' };
}

const KV_LINE = /^\*\*(.+?):\*\*\s*(.*)$/;

/** Lista «- **Etiqueta:** valor» como ficha de datos de dos columnas. */
function keyValueCard(items: string[]): string {
  const rows = items
    .map((l) => {
      const m = KV_LINE.exec(l)!;
      return (
        `<tr><td style="padding:7px 12px;font-size:13px;color:#5b6b78;white-space:nowrap;vertical-align:top;border-bottom:1px solid #e8edf3">${m[1]}</td>` +
        `<td style="padding:7px 12px;font-size:14px;color:#22272a;border-bottom:1px solid #e8edf3">${inlineMarkup(m[2])}</td></tr>`
      );
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;background:#f7f9fc;border:1px solid #e3e8ef;border-radius:8px">${rows}</table>`;
}

/** Código y estado arriba del cuerpo, como en el panel. Valores crudos: se escapan aquí. */
function ticketHeader(values: TemplateValues): string {
  const codigo = String(values.codigo ?? '').trim();
  if (!codigo) return '';
  const estado = String(values.estado ?? '').trim();
  const chip = estado
    ? ` <span style="display:inline-block;margin-left:8px;padding:3px 10px;border-radius:999px;background:#e6edf8;color:${KUBO_BLUE_DARK};font-size:12px;font-weight:600">${escapeEmailHtml(estado)}</span>`
    : '';
  return `<p style="margin:0 0 18px;font-size:13px;font-weight:700;letter-spacing:.04em;color:${KUBO_BLUE}"><span>${escapeEmailHtml(codigo)}</span>${chip}</p>`;
}

/**
 * Convierte el texto ya renderizado en el cuerpo con diseño: párrafos, listas
 * (o ficha de datos si son «**Etiqueta:** valor»), una URL suelta como botón y,
 * al final, el recuadro de acción. La URL suelta que coincide con la acción se
 * quita (la lleva el botón) y la frase que la presentaba termina en punto.
 *
 * **No escapa el texto.** El contenido del cliente ya viene escapado por
 * `render`, y volver a escapar aquí convertiría un `&lt;` en `&amp;lt;`. Lo
 * único que se añade son etiquetas propias; el cuerpo de una plantilla lo
 * escribe un ADMIN y pasa por `validateTemplate`. El `html` de la vista previa
 * se muestra aislado (iframe `srcDoc`), nunca inyectado en el panel.
 */
function textToSimpleHtml(text: string, action: EmailAction | null, header: string): string {
  const actionUrlEscaped = action ? escapeHtml(action.url) : null;
  const bloques = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .map((bloque) => {
      let lineas = bloque.split('\n').map((l) => l.trim());
      if (lineas.every((l) => l.startsWith('- '))) {
        const items = lineas.map((l) => l.slice(2));
        if (items.every((l) => KV_LINE.test(l))) return keyValueCard(items);
        return `<ul style="margin:0 0 14px;padding-left:22px">${items.map((l) => `<li>${inlineMarkup(l)}</li>`).join('')}</ul>`;
      }
      if (actionUrlEscaped && lineas.includes(actionUrlEscaped)) {
        const i = lineas.indexOf(actionUrlEscaped);
        if (i > 0) lineas[i - 1] = lineas[i - 1].replace(/:\s*$/, '.');
        lineas = lineas.filter((l) => l !== actionUrlEscaped);
        if (lineas.length === 0) return '';
      }
      if (lineas.length === 1 && /^https?:\/\/\S+$/.test(lineas[0])) {
        const url = undoHtmlEscaping(lineas[0]);
        return emailButton(url, url.includes('/portal/') ? 'Ver en el portal' : 'Abrir enlace');
      }
      const contenido = lineas.map(inlineMarkup).join('<br>');
      // El pie de las plantillas sembradas (015 y 018) empieza siempre así; se mira el
      // comienzo del párrafo para no confundirlo con un valor del cliente.
      if (/^Este correo es automático/i.test(bloque)) {
        return `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#7a8794">${contenido}</p>`;
      }
      return `<p style="margin:0 0 14px">${contenido}</p>`;
    })
    .filter((b) => b.length > 0);

  // El aviso en letra pequeña va al final, después del recuadro de acción.
  const pie = bloques.filter((b) => b.includes('font-size:12px;line-height:1.5;color:#7a8794'));
  const cuerpo = bloques.filter((b) => !pie.includes(b));
  let accion = '';
  if (action) {
    accion = action.title
      ? emailCallout(escapeEmailHtml(action.title), escapeEmailHtml(action.body ?? ''), { href: action.url, label: action.label })
      : emailButton(action.url, action.label);
  }
  return [header, ...cuerpo, accion, ...pie].join('');
}

/**
 * Compone el asunto y el cuerpo (HTML y texto plano) de un correo de aviso.
 *
 * El asunto y la parte de texto van sin las entidades HTML que introduce
 * `render`: ninguno de los dos es HTML. El `html` sí las conserva.
 */
export function composeEmail(
  template: ComposableTemplate,
  audience: NotificationAudience,
  values: TemplateValues,
): ComposedEmail {
  const subject = render(template.subject, audience, values);
  const body = render(template.bodyMd, audience, values);

  return {
    subject: undoHtmlEscaping(subject),
    html: textToSimpleHtml(body, actionFor(audience, template.triggerKey, values), ticketHeader(values)),
    text: undoHtmlEscaping(body),
  };
}
