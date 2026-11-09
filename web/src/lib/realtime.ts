import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

import { api, isSessionExpiredError, refreshAccessToken, TOKEN_STORAGE_KEY } from '../api/client';

/** Lo que manda el backend cuando entra un ticket (TicketsRealtimeGateway). */
export interface TicketCreatedEvent {
  id: number;
  code: string | null;
  subject: string | null;
  priority: string;
  origin: string;
}

/** Grupo de errores nuevo o reabierto (ErrorNewPayload del gateway). */
export interface ErrorNewEvent {
  id: number;
  title: string;
  aplicativo: string;
  clienteNombre: string | null;
  reopened: boolean;
  reason: string | null;
}

/** Línea en vivo (LiveLogLine del backend): como LogLineView pero sin id ni propiedades. */
export interface LiveLogLine {
  ts: string;
  nivel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  instalacionId: number;
  clienteId: number | null;
  sistemaId: number | null;
  aplicativo: string;
  servidor: string;
  logger: string;
  mensaje: string;
  excepcion: string | null;
  hilo: string | null;
}

/** Líneas en vivo ya filtradas por el servidor; `omitidas` cuenta el exceso sobre 200/s. */
export interface LogsLinesEvent {
  lines: LiveLogLine[];
  omitidas: number;
}

export interface DiskAlertEvent {
  usedPct: number;
  threshold: number;
}

interface RealtimeEvents {
  'ticket:created': TicketCreatedEvent;
  'tickets:changed': Record<string, never>;
  'error:new': ErrorNewEvent;
  'errors:changed': Record<string, never>;
  'logs:lines': LogsLinesEvent;
  'monitoreo:disco': DiskAlertEvent;
}

let socket: Socket | null = null;

/** Primera espera antes de renovar y reconectar tras un rechazo del servidor. */
const AUTH_RETRY_BASE_MS = 2_000;
/** Techo de la espera creciente: con el backend caído no se martillea. */
const AUTH_RETRY_MAX_MS = 60_000;
/**
 * Cuánto tiene que aguantar una conexión para dar por buena la sesión y volver
 * a la espera inicial. No basta con `connect`: el gateway acepta el socket y lo
 * corta después de verificar el token, así que un `connect` llega también en
 * cada rechazo y reiniciar ahí la espera sería un bucle de refresh cada 2 s.
 */
const STABLE_CONNECTION_MS = 10_000;

let authRetryTimer: ReturnType<typeof setTimeout> | null = null;
let stableTimer: ReturnType<typeof setTimeout> | null = null;
let authRetryAttempt = 0;

function clearTimers(): void {
  if (authRetryTimer) clearTimeout(authRetryTimer);
  if (stableTimer) clearTimeout(stableTimer);
  authRetryTimer = null;
  stableTimer = null;
}

/**
 * El servidor rechazó el socket (token vencido, típico tras reiniciar el
 * backend con la pestaña en segundo plano: el access token dura 15 minutos y
 * ninguna petición REST lo ha renovado). Se renueva con el MISMO refresh
 * single-flight que usa axios y luego se reconecta; `auth` lee el token de
 * `localStorage` en cada intento, así que la reconexión ya lleva el nuevo.
 *
 * Espera creciente (2 s, 4 s, ... hasta 60 s) para no entrar en bucle. Si el
 * refresh dice que la sesión se acabó de verdad (sin refresh token o 4xx), se
 * deja de intentar: el cierre de sesión normal llega con la próxima petición
 * REST, que recibe el 401 y pasa por `doLogout`. Un error de red o un 5xx (el
 * backend aún arrancando) sí se reintenta.
 */
function scheduleAuthRetry(s: Socket): void {
  if (authRetryTimer) return;
  const delay = Math.min(AUTH_RETRY_MAX_MS, AUTH_RETRY_BASE_MS * 2 ** authRetryAttempt);
  authRetryAttempt += 1;
  authRetryTimer = setTimeout(() => {
    authRetryTimer = null;
    // Se cerró sesión (o se rehízo el socket) mientras esperábamos.
    if (socket !== s) return;
    refreshAccessToken().then(
      () => {
        if (socket === s && !s.connected) s.connect();
      },
      (err: unknown) => {
        if (socket !== s || isSessionExpiredError(err)) return;
        scheduleAuthRetry(s);
      },
    );
  }, delay);
}

/**
 * Una sola conexión por pestaña, compartida por todo el panel.
 *
 * El origen sale de la misma `baseURL` que usa la API REST, así funciona igual
 * con `http://localhost:3000/api/v1` en desarrollo que con una ruta relativa
 * detrás de Caddy. El path `/api/socket.io` es el que Caddy ya enruta al
 * backend.
 *
 * `auth` es una función y no un objeto: socket.io la vuelve a llamar en cada
 * reconexión, así que tras un refresh del access token la reconexión lleva el
 * token nuevo en vez del vencido.
 */
function getSocket(): Socket {
  if (socket) return socket;
  const base = new URL(api.defaults.baseURL ?? '/api/v1', window.location.href);
  socket = io(`${base.origin}/tickets`, {
    path: '/api/socket.io',
    transports: ['websocket', 'polling'],
    auth: (cb) => cb({ token: localStorage.getItem(TOKEN_STORAGE_KEY) ?? '' }),
  });
  const s = socket;
  s.on('connect', () => {
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = setTimeout(() => {
      stableTimer = null;
      authRetryAttempt = 0;
    }, STABLE_CONNECTION_MS);
  });
  // El backend corta a quien llega con token vencido, y socket.io no reintenta
  // un corte del servidor por su cuenta: se renueva el token y se reconecta.
  s.on('disconnect', (reason) => {
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = null;
    if (reason === 'io server disconnect') scheduleAuthRetry(s);
  });
  // `connect_error` con `active === false` es un rechazo del servidor (un
  // middleware que deniega el handshake): socket.io tampoco reintenta solo.
  // Con `active === true` es un fallo de transporte (backend caído) y
  // socket.io ya reintenta con su propia espera; el token se renovará si el
  // servidor, al volver, corta el socket.
  s.on('connect_error', () => {
    if (!s.active) scheduleAuthRetry(s);
  });
  return s;
}

/** Cierra la conexión (al cerrar sesión). */
export function disconnectRealtime(): void {
  clearTimers();
  authRetryAttempt = 0;
  socket?.disconnect();
  socket = null;
}

/** Se suscribe a un evento en vivo mientras el componente esté montado. */
export function useRealtime<E extends keyof RealtimeEvents>(
  event: E,
  handler: (data: RealtimeEvents[E]) => void,
): void {
  useEffect(() => {
    const s = getSocket();
    const fn = handler as (data: unknown) => void;
    s.on(event as string, fn);
    return () => {
      s.off(event as string, fn);
    };
  }, [event, handler]);
}

/**
 * Mensajes del cliente al servidor (`logs:subscribe` con el filtro, o
 * `logs:unsubscribe`). El servidor contesta con un ack `{ ok }` que aquí se
 * ignora: si fue falso (el handshake aún no metía al socket en `staff`), la
 * pantalla reenvía al reconectar con `useRealtimeConnect`.
 */
export function emitRealtime(event: 'logs:subscribe' | 'logs:unsubscribe', payload?: unknown): void {
  getSocket().emit(event, payload ?? {});
}

/**
 * Llama a `handler` en cada `connect`, incluida la reconexión (y de inmediato
 * si el socket ya está conectado al montar). socket.io pierde las salas al
 * reconectar: quien depende de una suscripción tiene que repetirla aquí.
 */
export function useRealtimeConnect(handler: () => void): void {
  useEffect(() => {
    const s = getSocket();
    s.on('connect', handler);
    if (s.connected) handler();
    return () => {
      s.off('connect', handler);
    };
  }, [handler]);
}
