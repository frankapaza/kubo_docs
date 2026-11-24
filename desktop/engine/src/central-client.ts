import type { CheckResult, Criticality, ProbeSignal, ScheduleConfig, ServiceTarget, TrackerState } from '@kubo/monitoring-core';

/** Vista de una sonda tal como llega en JSON (fechas ISO). */
export interface ProbeView {
  state: TrackerState;
  lastCheckAt: string | null;
  lastLatencyMs: number | null;
}

export type CombinedStatus = 'OK' | 'VERIFYING' | 'DEGRADED' | 'DOWN' | 'ROUTE' | 'NO_DATA';

/** Fila del estado combinado (`backend/.../domain/combined-state.ts`), serializada. */
export interface CombinedStateRow {
  serviceId: number;
  serverId: number;
  clientId: number;
  serviceName: string;
  serverName: string;
  criticality: Criticality;
  office: ProbeView | null;
  datacenter: ProbeView | null;
  status: CombinedStatus;
  incidentId: number | null;
  parentIncidentId: number | null;
  ticketCode: string | null;
}

export interface ProbeConfig {
  services: ServiceTarget[];
  schedule: ScheduleConfig;
  references: ServiceTarget[];
}

export interface SyncResponse {
  configVersion: string;
  /** null si la `configVersion` enviada sigue vigente. */
  config: ProbeConfig | null;
  orders: { id: number; serviceId: number; kind: 'MANUAL' | 'CROSS' }[];
  state: CombinedStateRow[];
}

export interface ProbeBatch {
  checks: CheckResult[];
  signals: ProbeSignal[];
  version: string;
}

export interface AcceptBatchResult {
  acceptedChecks: number;
  duplicateChecks: number;
  acceptedSignals: number;
  duplicateSignals: number;
}

/** Lo que el motor necesita de la central (la implementación real y la falsa de las pruebas). */
export interface CentralApi {
  sync(configVersion: string | null): Promise<SyncResponse>;
  sendBatch(batch: ProbeBatch): Promise<AcceptBatchResult>;
}

/** Respuesta HTTP no 2xx de la central. `retryAfterSec` solo en 429. */
export class CentralHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSec: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'CentralHttpError';
  }
}

export const CENTRAL_TIMEOUT_MS = 10_000;

/**
 * Cliente HTTP de la ingesta de sondas (`/api/v1/ingest/probe/*`): `fetch` con
 * `Authorization: Bearer kmp_…`, 10 s de tiempo de espera y la validación TLS
 * normal de Node (nunca se desactiva).
 */
export class CentralClient implements CentralApi {
  private readonly base: string;

  constructor(
    centralUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.base = `${centralUrl.replace(/\/+$/, '')}/api/v1/ingest/probe`;
  }

  async sync(configVersion: string | null): Promise<SyncResponse> {
    const qs = configVersion ? `?configVersion=${encodeURIComponent(configVersion)}` : '';
    return (await this.request('GET', `/sync${qs}`)) as SyncResponse;
  }

  async sendBatch(batch: ProbeBatch): Promise<AcceptBatchResult> {
    return (await this.request('POST', '/batch', batch)) as AcceptBatchResult;
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CENTRAL_TIMEOUT_MS),
    });
    if (!res.ok) {
      const ra = Number(res.headers.get('retry-after'));
      const text = await res.text().catch(() => '');
      throw new CentralHttpError(
        res.status,
        res.status === 429 && Number.isFinite(ra) && ra > 0 ? ra : res.status === 429 ? 60 : null,
        `Central ${method} ${path} → HTTP ${res.status} ${text.slice(0, 200)}`,
      );
    }
    return res.json();
  }
}
