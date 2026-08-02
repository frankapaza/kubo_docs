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

import { NotificationAudience, TemplateValues, render } from './template-renderer';

/** Lo mínimo de una plantilla que hace falta para componer un correo. */
export interface ComposableTemplate {
  subject: string;
  bodyMd: string;
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

/**
 * Convierte el texto ya renderizado en HTML sencillo: párrafos separados por
 * línea en blanco, bloques de líneas que empiezan por `- ` como lista, y
 * saltos de línea sueltos como `<br>`.
 *
 * **No escapa nada.** El contenido del cliente ya viene escapado por `render`,
 * y volver a escapar aquí convertiría un `&lt;` en `&amp;lt;`, que es lo que el
 * lector vería en pantalla. Tampoco puede inyectar: lo único que se añade son
 * las etiquetas que pone esta función, y un `<` del cliente ya no es un `<`
 * cuando llega hasta aquí. El resto del texto lo escribe el equipo en el panel
 * y pasa por `validateTemplate` al guardarse.
 *
 * Es una decisión deliberada, no un descuido: el cuerpo de una plantilla
 * **no se escapa**, así que un ADMIN puede escribir HTML crudo (un enlace, una
 * negrita) y sale tal cual en el correo -- quien lo edita es personal interno
 * con rol de administración, y quien lo lee lo hace en un cliente de correo
 * que ya sanea. **Nota para quien construya la pantalla de previsualización
 * (Task 8):** por esto mismo, el `html` que devuelve `composeEmail` tiene que
 * renderizarse de forma aislada (p. ej. un `iframe` en `sandbox`, o `srcDoc`),
 * nunca inyectado directamente en el DOM del propio panel.
 */
function textToSimpleHtml(text: string): string {
  const bloques = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .map((bloque) => {
      const lineas = bloque.split('\n').map((l) => l.trim());
      if (lineas.every((l) => l.startsWith('- '))) {
        const items = lineas.map((l) => `<li>${inlineMarkup(l.slice(2))}</li>`).join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${lineas.map(inlineMarkup).join('<br>')}</p>`;
    });

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#22272a">${bloques.join(
    '',
  )}</div>`;
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
    html: textToSimpleHtml(body),
    text: undoHtmlEscaping(body),
  };
}
