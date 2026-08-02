import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  PortalClientSystem,
  PortalSession,
  PortalTicket,
  PortalTicketDetail,
} from './types';

/**
 * Instancia de axios propia del portal de clientes, independiente de la de
 * `client.ts`. El token vive bajo una clave de `localStorage` distinta de la
 * del panel interno (`kubo.accessToken`) para que un usuario cliente y un
 * miembro del equipo puedan tener sesión abierta a la vez en el mismo
 * navegador sin pisarse.
 */
export const PORTAL_TOKEN_STORAGE_KEY = 'kubo_portal_token';
// Exportada para que `PortalAuthContext` guarde el refreshToken tras el login
// bajo la misma clave que usa el interceptor de refresh de aquí abajo, sin
// duplicar el literal ni crear un segundo almacenamiento.
export const PORTAL_REFRESH_TOKEN_KEY = 'kubo_portal_refresh_token';

/** Límites de `CreatePortalTicketDto` en el backend: deben coincidir siempre con él. */
export const PORTAL_TICKET_SUBJECT_MAX_LENGTH = 240;
export const PORTAL_TICKET_DESCRIPTION_MAX_LENGTH = 16383;

export const portalApiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1',
});

portalApiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(PORTAL_TOKEN_STORAGE_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Promesa de refresh compartida — varios 401 simultáneos reutilizan el mismo intento.
let refreshPromise: Promise<string> | null = null;

function doPortalLogout() {
  localStorage.removeItem(PORTAL_TOKEN_STORAGE_KEY);
  localStorage.removeItem(PORTAL_REFRESH_TOKEN_KEY);
  // Al login del portal, nunca al del panel interno.
  if (window.location.pathname !== '/portal/login') window.location.href = '/portal/login';
}

portalApiClient.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const original = err.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (err.response?.status !== 401 || original?._retry) {
      return Promise.reject(err);
    }

    const refreshToken = localStorage.getItem(PORTAL_REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      doPortalLogout();
      return Promise.reject(err);
    }

    original._retry = true;
    try {
      if (!refreshPromise) {
        const base = portalApiClient.defaults.baseURL;
        refreshPromise = axios
          .post<PortalSession>(`${base}/portal/auth/refresh`, { refreshToken })
          .then((r) => {
            localStorage.setItem(PORTAL_TOKEN_STORAGE_KEY, r.data.accessToken);
            localStorage.setItem(PORTAL_REFRESH_TOKEN_KEY, r.data.refreshToken);
            return r.data.accessToken;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }

      const newToken = await refreshPromise;
      original.headers.Authorization = `Bearer ${newToken}`;
      return portalApiClient(original);
    } catch {
      doPortalLogout();
      return Promise.reject(err);
    }
  },
);

/**
 * Cuerpo de alta de ticket desde el portal. Sin `clientId`: el backend lo
 * toma siempre del token de sesión, y el `ValidationPipe` global rechaza con
 * 400 cualquier propiedad no declarada aquí.
 */
export interface CreatePortalTicketBody {
  subject: string;
  description: string;
  systemId?: number;
}

export const portalApi = {
  login: (email: string, password: string) =>
    portalApiClient
      .post<PortalSession>('/portal/auth/login', { email, password })
      .then((r) => r.data),

  refresh: (refreshToken: string) =>
    portalApiClient
      .post<PortalSession>('/portal/auth/refresh', { refreshToken })
      .then((r) => r.data),

  listTickets: () => portalApiClient.get<PortalTicket[]>('/portal/tickets').then((r) => r.data),

  getTicket: (id: number) =>
    portalApiClient.get<PortalTicketDetail>(`/portal/tickets/${id}`).then((r) => r.data),

  createTicket: (body: CreatePortalTicketBody) =>
    portalApiClient.post<PortalTicket>('/portal/tickets', body).then((r) => r.data),

  listSystems: () =>
    portalApiClient.get<PortalClientSystem[]>('/portal/systems').then((r) => r.data),
};
