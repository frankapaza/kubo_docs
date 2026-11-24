import { EngineDownTracker, engineDownToast, nextCursorState, toastsFor, type Toast } from '../shared/notify-policy';
import type { EngineEvent } from '../shared/types';
import { deriveModel, type EngineReach, type WidgetModel } from '../shared/widget-model';

export const POLL_INTERVAL_MS = 5_000;
const EVENTS_PAGE = 100;
const MAX_PAGES_PER_TICK = 10;
/** El diario del motor guarda como mucho 5000 eventos: 10 páginas de 500, más una de sobra. */
const SUMMARY_PAGE = 500;
const SUMMARY_MAX_PAGES = 11;

type EventsFn = (after: number, limit?: number) => Promise<{ lastId: number; events: EngineEvent[] }>;

export interface PollerDeps {
  client: { status(): Promise<EngineReach>; events: EventsFn };
  store: { cursor: number };
  notify(toast: Toast, centralUrl: string): void;
  onModel(model: WidgetModel, reach: EngineReach): void;
  now(): number;
  /** Instante de arranque del widget: nunca se avisa de eventos anteriores. */
  startedAt: number;
}

export function normalizeCentralUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Un paso del bucle de 5 s: estado -> modelo; diario -> avisos. Nunca lanza. */
export class Poller {
  centralUrl: string | null = null;
  lastReach: EngineReach = { kind: 'connecting' };
  private readonly tracker = new EngineDownTracker();
  private readonly recent = new Map<string, number>();

  constructor(private readonly deps: PollerDeps) {}

  async tick(): Promise<void> {
    const { deps } = this;
    let reach: EngineReach;
    try {
      reach = await deps.client.status();
    } catch {
      reach = { kind: 'down' };
    }
    this.lastReach = reach;
    if (reach.kind === 'ok') this.centralUrl = normalizeCentralUrl(reach.status.centralUrl);
    deps.onModel(deriveModel(reach, new Date(deps.now())), reach);
    if (this.tracker.update(reach.kind) && this.centralUrl) deps.notify(engineDownToast(this.centralUrl), this.centralUrl);
    if (reach.kind !== 'ok' || !this.centralUrl) return;
    try {
      await this.drainEvents(this.centralUrl);
    } catch {
      // Motor ocupado, sin permiso o respuesta inválida: se reintenta en el siguiente paso.
    }
  }

  private async drainEvents(centralUrl: string): Promise<void> {
    const { deps } = this;
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const cursor = deps.store.cursor;
      const res = await deps.client.events(cursor, EVENTS_PAGE);
      const next = nextCursorState(cursor, res, deps.startedAt);
      if (next.cursor !== cursor) deps.store.cursor = next.cursor;
      for (const t of toastsFor(next.toast, centralUrl, this.recent, deps.now())) deps.notify(t, centralUrl);
      if (res.events.length < EVENTS_PAGE || next.cursor === cursor) return;
    }
  }
}

/** Todo el diario disponible desde el principio (para el resumen al iniciar sesión). */
export async function fetchAllEvents(client: { events: EventsFn }, pageSize = SUMMARY_PAGE): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  let after = 0;
  for (let page = 0; page < SUMMARY_MAX_PAGES; page++) {
    const res = await client.events(after, pageSize);
    out.push(...res.events);
    if (res.events.length < pageSize) break;
    after = res.events.reduce((m, e) => Math.max(m, e.id), after);
  }
  return out;
}
