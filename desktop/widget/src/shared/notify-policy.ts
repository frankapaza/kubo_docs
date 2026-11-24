import type { EngineEvent } from './types';
import { limaTime } from './widget-model';

export interface Toast {
  title: string;
  body: string;
  url: string;
  dedupeKey: string;
}

export const DEDUPE_WINDOW_MS = 2 * 60 * 1000;

/** Etiqueta del evento: el servidor si la caída abarca varios servicios; si no, el servicio. */
function subject(e: EngineEvent): string {
  if (e.serviceNames.length > 1 && e.serverName) return e.serverName;
  return e.serviceNames[0] ?? e.serverName ?? '';
}

function titleFor(e: EngineEvent): string | null {
  const s = subject(e);
  switch (e.kind) {
    case 'INCIDENT_OPENED':
      return e.incidentKind === 'ROUTE' ? `Sin acceso desde Perú: ${s}` : `Caída: ${s}`;
    case 'INCIDENT_UPGRADED': return `Caída: ${s}`;
    case 'INCIDENT_RECOVERED': return `Recuperado: ${s}`;
    case 'OFFICE_OUTAGE_STARTED': return 'Sin internet en la oficina';
    case 'OFFICE_OUTAGE_ENDED': return 'Internet de la oficina restablecido';
    case 'CENTRAL_UNREACHABLE': return 'La central no responde';
    case 'CENTRAL_BACK': return 'La central vuelve a responder';
    case 'CENTRAL_REJECTING': return 'La central rechaza los envíos';
    default: return null;
  }
}

function bodyFor(e: EngineEvent): string {
  const parts: string[] = [];
  if (e.serviceNames.length > 0) parts.push(e.serviceNames.join(', '));
  if (e.ticketCode) parts.push(e.ticketCode);
  parts.push(limaTime(new Date(e.at)));
  return parts.join(' · ');
}

function boardUrl(centralUrl: string): string {
  return `${centralUrl}/monitoreo/estado`;
}

/** Solo usa `notify` (lo decide el motor) más la deduplicación de 2 minutos. */
export function toastsFor(events: EngineEvent[], centralUrl: string, recent: Map<string, number>, now: number): Toast[] {
  for (const [k, at] of recent) if (now - at >= DEDUPE_WINDOW_MS) recent.delete(k);
  const out: Toast[] = [];
  for (const e of events) {
    if (!e.notify) continue;
    const title = titleFor(e);
    if (title === null) continue;
    const dedupeKey = `${e.kind}:${e.incidentKey ?? ''}`;
    const last = recent.get(dedupeKey);
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) continue;
    recent.set(dedupeKey, now);
    out.push({
      title,
      body: bodyFor(e),
      url: e.incidentKey !== null ? `${centralUrl}/monitoreo/incidentes/${e.incidentKey}` : boardUrl(centralUrl),
      dedupeKey,
    });
  }
  return out;
}

export function engineDownToast(centralUrl: string): Toast {
  return { title: 'El motor no responde', body: 'KUBO Monitor dejó de vigilar. Revisa el servicio.', url: boardUrl(centralUrl), dedupeKey: 'ENGINE_DOWN:' };
}

/** Misma origen que la central, sin credenciales en la URL y ruta bajo /monitoreo/. */
export function isAllowedUrl(url: string, centralUrl: string): boolean {
  try {
    const u = new URL(url);
    const c = new URL(centralUrl);
    return (
      (u.protocol === 'https:' || u.protocol === 'http:') &&
      u.username === '' &&
      u.password === '' &&
      u.origin === c.origin &&
      u.pathname.startsWith('/monitoreo/')
    );
  } catch {
    return false;
  }
}

export interface CursorResult {
  cursor: number;
  toast: EngineEvent[];
}

/**
 * Si el motor reporta un `lastId` menor que el cursor, su base se recreó:
 * se reinicia a 0 sin avisar nada de esa respuesta. Nunca se avisa de eventos
 * anteriores al arranque del widget.
 */
export function nextCursorState(cursor: number, res: { lastId: number; events: EngineEvent[] }, startedAt: number): CursorResult {
  if (res.lastId < cursor) return { cursor: 0, toast: [] };
  const next = res.events.reduce((m, e) => Math.max(m, e.id), cursor);
  const toast = res.events.filter((e) => Date.parse(e.at) >= startedAt);
  return { cursor: next, toast };
}

/** 'down' seguidos (cada 5 s, ≈15 s) tras un 'ok' antes de avisar: un tropiezo puntual no avisa. */
export const ENGINE_DOWN_AFTER = 3;

/**
 * Dispara una sola vez tras `ENGINE_DOWN_AFTER` 'down' seguidos después de un 'ok' (nunca desde
 * connecting); se rearma al volver ok. Cualquier otro estado en medio corta la racha.
 */
export class EngineDownTracker {
  /** Hubo un 'ok' desde el último aviso. */
  private armed = false;
  private downs = 0;

  update(kind: 'ok' | 'connecting' | 'down' | 'forbidden'): boolean {
    if (kind === 'ok') {
      this.armed = true;
      this.downs = 0;
      return false;
    }
    if (kind !== 'down') {
      this.armed = false;
      this.downs = 0;
      return false;
    }
    if (!this.armed) return false;
    this.downs++;
    if (this.downs < ENGINE_DOWN_AFTER) return false;
    this.armed = false;
    this.downs = 0;
    return true;
  }
}
