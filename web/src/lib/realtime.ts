import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

import { api, TOKEN_STORAGE_KEY } from '../api/client';

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
  // El backend corta a quien llega con token vencido; socket.io no reintenta
  // un corte del servidor por su cuenta. Se reintenta con el token actual.
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') {
      setTimeout(() => {
        if (localStorage.getItem(TOKEN_STORAGE_KEY)) socket?.connect();
      }, 5000);
    }
  });
  return socket;
}

/** Cierra la conexión (al cerrar sesión). */
export function disconnectRealtime(): void {
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
