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

function doLogout() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
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
