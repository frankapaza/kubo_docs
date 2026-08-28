import { ConfigService } from '@nestjs/config';

import { PERU_TIME_ZONE } from '../../common/time-zone';
import { escapeHtml } from '../notifications/domain/template-renderer';

/** URL base del frontend cuando no hay `FRONTEND_URL`. La misma que el envío de firmas. */
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

/**
 * `|| ''` y no `??`: `docker-compose.yml` inyecta `FRONTEND_URL: ${FRONTEND_URL}`
 * y Compose **sustituye por cadena vacía** cuando la variable no está en el
 * `.env` — no omite la clave. Con `??`, ese vacío pasaría de largo y el enlace
 * saldría sin host: irreparable para quien lo recibe, porque el correo ya salió.
 *
 * Es la tercera copia de este mismo criterio en el proyecto (las otras dos
 * están en `notification-dispatcher.service.ts` y en
 * `document-signatories.service.ts`). Se repite a propósito y no se factoriza:
 * cada una vive en el módulo que la usa, y lo que no puede divergir —el `||`—
 * está anotado en las tres.
 */
export function resolveFrontendUrl(config: ConfigService): string {
  const raw = (config.get<string>('FRONTEND_URL') || '').trim();
  return (raw || DEFAULT_FRONTEND_URL).replace(/\/+$/, '');
}

/**
 * La dirección de la página pública de aceptar invitación.
 *
 * El secreto viaja en la ruta y no en la query porque los servidores intermedios
 * registran la query con más alegría, y este valor es una credencial.
 */
export function buildInvitationUrl(frontendUrl: string, secret: string): string {
  return `${frontendUrl.replace(/\/+$/, '')}/portal/invitacion/${secret}`;
}

export interface InvitationEmailInput {
  fullName: string;
  /** Razón social de la empresa, o `null` si no se pudo resolver. */
  clientName: string | null;
  acceptUrl: string;
  expiresAt: Date;
}

/**
 * Fecha legible en hora de Lima, nunca en la del proceso.
 *
 * Producción corre en UTC; imprimir con `toLocaleDateString` sin `timeZone` le
 * diría a un cliente peruano un día distinto del que ve en el portal. Es el
 * mismo fallo que ya mordió una vez en los correos de tickets.
 */
function fechaLegible(d: Date): string {
  return d.toLocaleDateString('es-PE', {
    timeZone: PERU_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * El correo que lleva la invitación.
 *
 * Tono deliberadamente sobrio: sin exclamaciones, sin mayúsculas en el asunto y
 * sin el vocabulario que disparan los filtros («gratis», «urgente», «haz clic
 * aquí»). Es el riesgo número 1 de la spec —que la invitación acabe en no
 * deseado— y lo poco que se puede hacer desde el texto se hace.
 */
export function buildInvitationEmail(input: InvitationEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  // `|| null` y no `?? null`: una razón social guardada como cadena vacía es
  // igual de inservible que la ausencia, y las dos tienen que caer al texto
  // neutro en vez de dejar un hueco en la frase.
  const empresa = (input.clientName || '').trim() || null;
  const deLaEmpresa = empresa ? ` de ${empresa}` : '';
  // La versión HTML lleva su propia copia, escapada. El nombre de la persona
  // invitada y la razón social los teclea alguien —un administrador de cliente
  // al invitar, el personal al dar de alta la empresa— y sin escapar, un
  // `Ana<script>…` sale como etiqueta viva en el mensaje. Se reutiliza el
  // `escapeHtml` del renderizador de plantillas, que ya cierra exactamente
  // esto en los correos de tickets, en vez de escribir un segundo escapado.
  //
  // Solo en el HTML: escapar el asunto o la versión de texto metería
  // `&amp;` literales donde no hay ningún marcado que interpretar.
  const deLaEmpresaHtml = empresa ? ` de ${escapeHtml(empresa)}` : '';
  const caduca = fechaLegible(input.expiresAt);

  const subject = empresa
    ? `Acceso al portal de clientes de ${empresa}`
    : 'Acceso al portal de clientes';

  const text = [
    `Hola ${input.fullName}:`,
    '',
    `Te damos acceso al portal de clientes${deLaEmpresa}. Para entrar, primero`,
    'elige tu contraseña en esta dirección:',
    '',
    input.acceptUrl,
    '',
    `El enlace sirve hasta el ${caduca} y solo se puede usar una vez.`,
    'Si no esperabas este mensaje, puedes ignorarlo.',
  ].join('\n');

  const html = `
    <p>Hola ${escapeHtml(input.fullName)}:</p>
    <p>Te damos acceso al portal de clientes${deLaEmpresaHtml}. Para entrar, primero
       elige tu contraseña:</p>
    <p><a href="${input.acceptUrl}">Elegir mi contraseña</a></p>
    <p>Si el enlace no funciona, copia esta dirección en tu navegador:<br>
       ${input.acceptUrl}</p>
    <p>El enlace sirve hasta el ${caduca} y solo se puede usar una vez.</p>
    <p>Si no esperabas este mensaje, puedes ignorarlo.</p>
  `.trim();

  return { subject, html, text };
}
