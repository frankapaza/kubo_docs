import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogLevel } from '../domain/log-level';

/** Etiquetas fijas de cada stream: baja cardinalidad, el resto va en la línea. */
export interface LokiLabels {
  instalacion: string;
  cliente: string;
  sistema: string;
  aplicativo: string;
  servidor: string;
  nivel: LogLevel;
}

export interface LokiStream {
  labels: LokiLabels;
  entries: Array<{ at: Date; line: string }>;
}

export type LokiPushResult =
  | { ok: true }
  | { ok: false; retryable: boolean; status: number | null; message: string };

export interface LokiEntry {
  labels: Record<string, string>;
  tsNs: string;
  line: string;
}

const DEFAULT_URL = 'http://loki:3100';
const DEFAULT_TIMEOUT_MS = 5000;

function toNs(d: Date): bigint {
  return BigInt(d.getTime()) * 1_000_000n;
}

@Injectable()
export class LokiClient {
  private readonly logger = new Logger(LokiClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  /** Público solo para que las pruebas sustituyan `fetch` en la instancia. */
  fetchFn: typeof fetch = (...args) => fetch(...args);

  constructor(cfg: ConfigService) {
    this.baseUrl = (cfg.get<string>('LOKI_URL', DEFAULT_URL) || DEFAULT_URL).replace(/\/+$/, '');
    const t = Number(cfg.get<string>('LOKI_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS)));
    this.timeoutMs = Number.isFinite(t) && t > 0 ? t : DEFAULT_TIMEOUT_MS;
  }

  /**
   * ns de cada entrada de un stream, función pura de la entrada.
   *
   * Parte de la hora del evento y solo desplaza 1 ns cuando OTRA entrada del
   * mismo stream (en esta llamada) ya ocupa ese ns: Loki deduplica por
   * ts+línea dentro del stream y el orden entre iguales quedaría indefinido.
   * Sin estado de instancia: un reintento del mismo lote produce los mismos
   * ns y Loki lo deduplica en lugar de duplicarlo, y una entrada antigua no
   * se corre por haber enviado otra más nueva.
   */
  private streamValues(entries: LokiStream['entries']): [string, string][] {
    const used = new Set<bigint>();
    return entries.map((e) => {
      let ns = toNs(e.at);
      while (used.has(ns)) ns += 1n;
      used.add(ns);
      return [String(ns), e.line];
    });
  }

  async push(streams: LokiStream[]): Promise<LokiPushResult> {
    const body = {
      streams: streams
        .filter((s) => s.entries.length > 0)
        .map((s) => ({
          stream: s.labels,
          values: this.streamValues(s.entries),
        })),
    };
    if (body.streams.length === 0) return { ok: true };

    try {
      const r = await this.fetchFn(`${this.baseUrl}/loki/api/v1/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (r.status === 204 || r.ok) return { ok: true };
      const message = (await r.text().catch(() => '')) || `HTTP ${r.status}`;
      // 5xx y 429: Loki no pudo ahora, el mismo lote puede entrar después.
      // El resto de 4xx es un rechazo definitivo: reintentar no lo arregla.
      const retryable = r.status >= 500 || r.status === 429;
      return { ok: false, retryable, status: r.status, message };
    } catch (e) {
      // Timeout o red caída: transitorio por definición.
      return { ok: false, retryable: true, status: null, message: (e as Error).message };
    }
  }

  async queryRange(q: {
    query: string;
    start: Date;
    end: Date;
    /** Fin exacto en ns: un Date solo llega al ms y el cursor necesita ns para no repetir ni saltar líneas. */
    endNs?: string;
    limit: number;
    direction: 'backward' | 'forward';
  }): Promise<LokiEntry[]> {
    const params = new URLSearchParams({
      query: q.query,
      start: String(toNs(q.start)),
      end: q.endNs ?? String(toNs(q.end)),
      limit: String(q.limit),
      direction: q.direction,
    });
    try {
      const r = await this.fetchFn(`${this.baseUrl}/loki/api/v1/query_range?${params}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(() => '')}`);
      const json = JSON.parse(await r.text()) as {
        data?: { result?: Array<{ stream: Record<string, string>; values: [string, string][] }> };
      };
      const out: LokiEntry[] = [];
      for (const s of json.data?.result ?? []) {
        for (const [tsNs, line] of s.values) out.push({ labels: s.stream, tsNs, line });
      }
      // Loki ordena dentro de cada stream; al aplanar varios hay que reordenar.
      const sign = q.direction === 'backward' ? -1 : 1;
      out.sort((a, b) => {
        const d = BigInt(a.tsNs) - BigInt(b.tsNs);
        return d === 0n ? 0 : d < 0n ? -sign : sign;
      });
      return out;
    } catch (e) {
      this.logger.warn(`Loki no disponible: ${(e as Error).message}`);
      throw new ServiceUnavailableException({
        code: 'LOKI_UNAVAILABLE',
        message: 'El almacén de logs no está disponible. Reintenta en un momento.',
      });
    }
  }

  async ready(): Promise<boolean> {
    try {
      const r = await this.fetchFn(`${this.baseUrl}/ready`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return r.status === 200;
    } catch {
      return false;
    }
  }
}
