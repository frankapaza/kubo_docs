/** Forma mínima de un servicio por protocolo; la comparten el alta manual y la importación CSV. */
export type ServiceShapeError = 'HTTPS_URL' | 'TCP_PORT';

export function serviceShapeError(protocol: string, target: string, port: number | null): ServiceShapeError | null {
  if (protocol === 'HTTPS' && !target.startsWith('https://')) return 'HTTPS_URL';
  if (protocol === 'TCP' && (port === null || !Number.isInteger(port) || port < 1 || port > 65535)) return 'TCP_PORT';
  return null;
}
