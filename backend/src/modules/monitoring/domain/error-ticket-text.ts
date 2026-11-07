import { formatPeruDateTime } from '../../../common/peru-date-time';

/** Tope del texto del ticket: el de `tickets.raw_text` con holgura (columna TEXT = 65535 bytes). */
export const TICKET_TEXT_MAX = 60_000;
const SUBJECT_MAX = 240;

export interface ErrorTicketGroup {
  id: number;
  title: string;
  aplicativo: string;
  logger: string;
  servers: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrencesTotal: number;
}

/**
 * Texto del ticket interno que nace de un error. Las fechas van en hora de
 * Perú (la que lee quien atiende) y la traza al final: es lo único que puede
 * ser enorme y por eso es lo que se sacrifica al recortar, no el enlace...
 * que va ANTES de la traza para que el recorte nunca lo corte.
 */
export function buildErrorTicketText(
  g: ErrorTicketGroup,
  last: { message: string; exception: string | null } | null,
  frontendUrl: string,
): { subject: string; rawText: string } {
  const base = frontendUrl.replace(/\/+$/, '');
  const lines = [
    `Error detectado por el monitoreo: ${g.title}`,
    '',
    `Aplicativo: ${g.aplicativo}`,
    `Servidores: ${g.servers.join(', ') || '(sin dato)'}`,
    `Primera vez: ${formatPeruDateTime(g.firstSeenAt)}`,
    `Última vez: ${formatPeruDateTime(g.lastSeenAt)}`,
    `Ocurrencias: ${g.occurrencesTotal}`,
    `Logger: ${g.logger}`,
    `Enlace: ${base}/monitoreo/errores/${g.id}`,
  ];
  if (last) {
    lines.push('', `Mensaje: ${last.message}`);
    if (last.exception) lines.push('', 'Traza de la última ocurrencia:', last.exception);
  }
  return { subject: g.title.slice(0, SUBJECT_MAX), rawText: lines.join('\n').slice(0, TICKET_TEXT_MAX) };
}
