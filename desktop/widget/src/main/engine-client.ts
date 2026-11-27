import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineEvent } from '../shared/types';
import type { EngineReach } from '../shared/widget-model';

export const SECRET_FILE = 'local-api.secret';
/** Mientras el widget acaba de arrancar, «motor caído» se informa como «conectando». */
export const CONNECTING_GRACE_MS = 30_000;
/** Tras un secreto ilegible no se vuelve a leer hasta pasado este tiempo. */
export const FORBIDDEN_RETRY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

/** Carpeta de datos del motor (misma resolución que desktop/engine/src/config.ts). */
export function monitorHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.KUBO_MONITOR_HOME) return env.KUBO_MONITOR_HOME;
  return join(env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData', 'KUBO', 'Monitor');
}

export interface EngineClientOptions {
  home: string;
  port: number;
  fetch?: typeof fetch;
  now?: () => number;
  /** Instante de arranque del widget (ms); por defecto, la creación del cliente. */
  startedAt?: number;
  /** Lectura del secreto (inyectable en pruebas). */
  readSecret?: (file: string) => string;
}

class ForbiddenError extends Error {}

export class EngineClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly readSecret: (file: string) => string;
  private forbiddenAt: number | null = null;

  constructor(private readonly opts: EngineClientOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.startedAt = opts.startedAt ?? this.now();
    this.readSecret = opts.readSecret ?? ((f) => readFileSync(f, 'utf8'));
  }

  async status(): Promise<EngineReach> {
    try {
      const res = await this.get('/v1/status');
      if (res.status === 401 || res.status === 403) return { kind: 'forbidden' };
      if (!res.ok) return this.down();
      return { kind: 'ok', status: await res.json() };
    } catch (e) {
      if (e instanceof ForbiddenError) return { kind: 'forbidden' };
      return this.down();
    }
  }

  async events(after: number, limit = 100): Promise<{ lastId: number; events: EngineEvent[] }> {
    const res = await this.get(`/v1/events?after=${after}&limit=${limit}`);
    if (!res.ok) throw new Error(`El motor respondió ${res.status}.`);
    return (await res.json()) as { lastId: number; events: EngineEvent[] };
  }

  private down(): EngineReach {
    return this.now() - this.startedAt < CONNECTING_GRACE_MS ? { kind: 'connecting' } : { kind: 'down' };
  }

  private secret(): string {
    if (this.forbiddenAt !== null && this.now() - this.forbiddenAt < FORBIDDEN_RETRY_MS) throw new ForbiddenError();
    try {
      const s = this.readSecret(join(this.opts.home, SECRET_FILE)).trim();
      this.forbiddenAt = null;
      return s;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        this.forbiddenAt = this.now();
        throw new ForbiddenError();
      }
      throw e;
    }
  }

  private get(path: string): Promise<Response> {
    const headers = { 'X-Kubo-Secret': this.secret() };
    return this.fetchFn(`http://127.0.0.1:${this.opts.port}${path}`, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }
}
