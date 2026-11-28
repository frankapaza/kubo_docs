export type Protocol = 'TCP' | 'HTTPS' | 'HTTP' | 'ICMP';
export type CheckKind = 'REGULAR' | 'RETRY' | 'MANUAL' | 'CROSS';
export type Criticality = 'HIGH' | 'MEDIUM' | 'LOW';
export type CheckErrorCode = 'TIMEOUT' | 'REFUSED' | 'DNS' | 'TLS' | 'HTTP_STATUS' | 'NETWORK';

export interface ServiceTarget {
  id: number;
  protocol: Protocol;
  target: string;
  port: number | null;
  latencyThresholdMs: number;
  /**
   * Intervalo propio en minutos (de día y de noche); debe dividir 1440. Sin él, el
   * horario global. Lo usan los pings de red, que se miden cada minuto.
   */
  intervalMin?: number;
}

export interface CheckResult {
  /** UUID v4 */
  id: string;
  serviceId: number;
  kind: CheckKind;
  /** ISO */
  cycleAt: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  errorCode: CheckErrorCode | null;
  httpStatus: number | null;
  orderId: number | null;
}

export interface ScheduleConfig {
  dayStartHour: number;
  nightStartHour: number;
  dayIntervalMin: number;
  nightIntervalMin: number;
}
