import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

export const TOKEN_STORAGE_KEY = 'kubo.accessToken';
const REFRESH_TOKEN_KEY = 'kubo.refreshToken';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Shared refresh promise — varios 401 simultáneos usan el mismo intento de refresh.
let refreshPromise: Promise<string> | null = null;

/**
 * ¿Estamos dentro del portal de clientes?
 *
 * Las dos sesiones conviven en el mismo navegador a propósito --tokens en claves
 * distintas de `localStorage`, dos instancias de axios-- para que un miembro del
 * equipo y un cliente puedan tener abiertas las dos superficies a la vez.
 */
function isPortalRoute(): boolean {
  const path = window.location.pathname;
  return path === '/portal' || path.startsWith('/portal/');
}

function doLogout() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);

  /**
   * **La sesión del panel no echa a nadie del portal.**
   *
   * `AuthProvider` (en `main.tsx`) arranca en toda la aplicación, así que un
   * navegador que conserve un token de panel caducado dispara un `GET
   * /users/me` **también al abrir una página del portal**. Sin esta condición,
   * ese 401 acababa aquí y hacía una navegación dura a `/login`, que es la
   * pantalla de acceso **del panel**: al cliente se le sacaba del portal de
   * golpe, y una navegación dura se lleva por delante todo lo que hubiera en
   * pantalla -- desde que el portal tiene hilo, el mensaje a medio escribir.
   *
   * Limpiar el token del panel sí se hace igualmente: está caducado y no sirve.
   * Lo que no se hace es **redirigir**, porque quien está delante no es quien
   * perdió esa sesión. La sesión del portal tiene su propio cierre en
   * `portal.api.ts`, que manda a `/portal/login` y es el que sí corresponde.
   */
  if (isPortalRoute()) return;

  if (window.location.pathname !== '/login') window.location.href = '/login';
}

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const original = err.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (err.response?.status !== 401 || original?._retry) {
      return Promise.reject(err);
    }

    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      doLogout();
      return Promise.reject(err);
    }

    original._retry = true;
    try {
      if (!refreshPromise) {
        const base = api.defaults.baseURL;
        refreshPromise = axios
          .post<{ accessToken: string; refreshToken?: string }>(`${base}/auth/refresh`, {
            refreshToken,
          })
          .then((r) => {
            localStorage.setItem(TOKEN_STORAGE_KEY, r.data.accessToken);
            if (r.data.refreshToken) {
              localStorage.setItem(REFRESH_TOKEN_KEY, r.data.refreshToken);
            }
            return r.data.accessToken;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }

      const newToken = await refreshPromise;
      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch {
      doLogout();
      return Promise.reject(err);
    }
  },
);
