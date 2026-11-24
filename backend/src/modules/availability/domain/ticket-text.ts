import { formatPeruDateTime } from '../../../common/peru-date-time';

export interface IncidentTicketInput {
  kind: 'DOWN' | 'ROUTE';
  serviceNames: string[];
  serverName: string;
  firstFailureAt: Date;
  confirmedAt: Date;
  diagnosis: string;
}

/** Asunto y texto del ticket interno de una caída. Horas en Lima. */
export function buildIncidentTicket(input: IncidentTicketInput): { subject: string; rawText: string } {
  const { kind, serviceNames, serverName } = input;
  let subject: string;
  if (serviceNames.length > 1) {
    subject =
      kind === 'ROUTE'
        ? `Sin acceso desde Perú al servidor ${serverName} (${serviceNames.length} servicios)`
        : `Caída del servidor ${serverName} (${serviceNames.length} servicios)`;
  } else {
    const name = serviceNames[0] ?? serverName;
    subject =
      kind === 'ROUTE' ? `Sin acceso desde Perú: ${name} (${serverName})` : `Caída: ${name} (${serverName})`;
  }
  const rawText = [
    subject,
    '',
    `Servidor: ${serverName}`,
    `Servicios: ${serviceNames.join(', ') || '(sin dato)'}`,
    `Primer fallo: ${formatPeruDateTime(input.firstFailureAt)}`,
    `Confirmado: ${formatPeruDateTime(input.confirmedAt)}`,
    '',
    input.diagnosis,
  ].join('\n');
  return { subject, rawText };
}
