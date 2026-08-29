import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  PortalClientSystem,
  PortalCreatedTicket,
  PortalInvitation,
  PortalMonthlyReport,
  PortalRequirement,
  PortalSession,
  PortalTeamMember,
  PortalTicket,
  PortalTicketDetail,
  ReportScope,
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
// El perfil (`clientUser`) se persiste aparte del token porque el backend del
// portal no expone un `/me` (ver `PortalAuthContext`). Exportada también para
// que el logout forzado de `doPortalLogout`, más abajo, y el `logout()` del
// contexto limpien exactamente las mismas tres claves, en vez de tener dos
// listas que alguien tiene que recordar mantener sincronizadas.
export const PORTAL_USER_STORAGE_KEY = 'kubo_portal_user';

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

/**
 * Rutas de autenticación del portal: un 401 en cualquiera de estas nunca debe
 * disparar un intento de refresco. Para `/portal/auth/login` es el caso real
 * — una contraseña equivocada con un refreshToken viejo en `localStorage`
 * gastaba una petición de login MÁS una de refresh, dos peticiones contra el
 * mismo endpoint que ahora tiene limitación de intentos (5/min por IP, ver
 * `ApiThrottlerGuard` en el backend): cada error de tecleo se cobraba doble
 * contra ese cupo. `/portal/auth/refresh` se incluye por completitud —hoy no
 * pasa por aquí porque usa `axios` directo, no `portalApiClient`, según el
 * comentario de `refreshPromise` más abajo— para que si alguna vez cambia de
 * cliente no reabra el mismo problema en silencio.
 */
function isPortalAuthRequest(url: string | undefined): boolean {
  return !!url && /\/portal\/auth\/(login|refresh)(\?|$)/.test(url);
}

function doPortalLogout() {
  localStorage.removeItem(PORTAL_TOKEN_STORAGE_KEY);
  localStorage.removeItem(PORTAL_REFRESH_TOKEN_KEY);
  localStorage.removeItem(PORTAL_USER_STORAGE_KEY);
  // Al login del portal, nunca al del panel interno.
  if (window.location.pathname !== '/portal/login') window.location.href = '/portal/login';
}

portalApiClient.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const original = err.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (
      err.response?.status !== 401 ||
      original?._retry ||
      isPortalAuthRequest(original?.url)
    ) {
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
            // El refresh también trae `clientUser` (con `isAdmin` al día), y hay
            // que guardarlo igual que el login: sin esto, una sesión abierta
            // antes de que `isAdmin` existiera se queda para siempre con el
            // perfil viejo en `localStorage` — el refresh renueva el token
            // indefinidamente pero nunca vuelve a escribir el perfil, así que
            // un administrador real dejaría de ver el botón de alta hasta
            // cerrar sesión a mano, sin ninguna señal de que tiene que hacerlo.
            //
            // Guardado solo si el campo viene: hoy el backend siempre lo manda,
            // pero sin esta guarda, si alguna vez faltara, `JSON.stringify`
            // devolvería `undefined` y `localStorage.setItem` lo coaccionaría a
            // la cadena literal "undefined". El siguiente `JSON.parse` de
            // PortalAuthContext lanzaría, y su catch borra las tres claves de
            // sesión: cierre de sesión de todo el portal, tickets incluidos, no
            // solo de requerimientos.
            if (r.data.clientUser) {
              localStorage.setItem(PORTAL_USER_STORAGE_KEY, JSON.stringify(r.data.clientUser));
            }
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

  /**
   * Devuelve `PortalCreatedTicket`: el alta trae además el `firstMessageId`
   * contra el que se suben los archivos que el cliente adjuntó al abrir el
   * ticket.
   */
  createTicket: (body: CreatePortalTicketBody) =>
    portalApiClient.post<PortalCreatedTicket>('/portal/tickets', body).then((r) => r.data),

  listSystems: () =>
    portalApiClient.get<PortalClientSystem[]>('/portal/systems').then((r) => r.data),

  listRequirements: () =>
    portalApiClient.get<PortalRequirement[]>('/portal/requerimientos').then((r) => r.data),

  getRequirement: (id: number) =>
    portalApiClient.get<PortalRequirement>(`/portal/requerimientos/${id}`).then((r) => r.data),

  createRequirement: (body: { title: string; descriptionMd: string }) =>
    portalApiClient.post<PortalRequirement>('/portal/requerimientos', body).then((r) => r.data),

  /**
   * Informe mensual (tarea 6 del backend). El backend rechaza el mes en
   * curso o uno futuro con un 400 en español -- la pantalla ya evita
   * ofrecerlos en el selector, pero esta llamada no repite esa validación:
   * es la misma que hace cumplir el límite de verdad.
   */
  getMonthlyReport: (year: number, month: number, scope: ReportScope) =>
    portalApiClient
      .get<PortalMonthlyReport>('/portal/informes/mensual', { params: { year, month, scope } })
      .then((r) => r.data),

  /**
   * La gente de mi empresa. El backend acota por el `clientId` del token: esta
   * llamada no manda ninguna empresa, y el `ValidationPipe` global rechazaría
   * con 400 cualquier propiedad de más si alguien la añadiera.
   */
  listTeam: () => portalApiClient.get<PortalTeamMember[]>('/portal/usuarios').then((r) => r.data),

  listInvitations: () =>
    portalApiClient.get<PortalInvitation[]>('/portal/usuarios/invitaciones').then((r) => r.data),

  invite: (body: { email: string; fullName: string }) =>
    portalApiClient
      .post<PortalInvitation>('/portal/usuarios/invitaciones', body)
      .then((r) => r.data),

  /** Emite un enlace nuevo y anula el anterior. Es el reintento del envío. */
  resendInvitation: (id: number) =>
    portalApiClient
      .post<PortalInvitation>(`/portal/usuarios/invitaciones/${id}/reenviar`)
      .then((r) => r.data),

  /** Le quita el acceso; no borra nada. El servidor rechaza que uno se quite a sí mismo. */
  deactivateTeamMember: (id: number) =>
    portalApiClient.post<PortalTeamMember>(`/portal/usuarios/${id}/desactivar`).then((r) => r.data),
};

/** Límites de `CreatePortalRequirementDto` en el backend: deben coincidir siempre con él. */
export const PORTAL_REQUIREMENT_TITLE_MAX_LENGTH = 240;
export const PORTAL_REQUIREMENT_DESCRIPTION_MAX_LENGTH = 16383;

/** Límites de `InvitePortalUserDto` en el backend: deben coincidir siempre con él. */
export const PORTAL_INVITE_NAME_MAX_LENGTH = 180;
export const PORTAL_INVITE_EMAIL_MAX_LENGTH = 180;
