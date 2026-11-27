import { api } from './client';
import { portalApiClient } from './portal.api';

/** Clave de la API de integración (sin el secreto: solo se ve al crearla). */
export interface ApiKey {
  id: number;
  nombre: string;
  prefijo: string;
  estado: 'ACTIVA' | 'REVOCADA';
  creadaEn: string;
  ultimoUso: string | null;
  revocadaEn: string | null;
}

export interface IssuedApiKey {
  key: ApiKey;
  /** La clave en claro. Solo viaja en la respuesta del alta. */
  secret: string;
}

/** Operaciones que necesita la pantalla de claves; el portal y el panel las implementan contra su ruta. */
export interface ApiKeysBackend {
  list: () => Promise<ApiKey[]>;
  issue: (nombre: string) => Promise<IssuedApiKey>;
  revoke: (id: number) => Promise<ApiKey>;
}

/** Portal: el administrador del cliente, sobre su propia empresa. */
export const portalApiKeys: ApiKeysBackend = {
  list: () => portalApiClient.get<ApiKey[]>('/portal/integraciones/claves').then((r) => r.data),
  issue: (nombre) => portalApiClient.post<IssuedApiKey>('/portal/integraciones/claves', { nombre }).then((r) => r.data),
  revoke: (id) => portalApiClient.post<ApiKey>(`/portal/integraciones/claves/${id}/revocar`).then((r) => r.data),
};

/** Panel: el personal ADMIN, sobre el cliente de la ficha. */
export function staffApiKeys(clientId: number): ApiKeysBackend {
  return {
    list: () => api.get<ApiKey[]>(`/clients/${clientId}/api-keys`).then((r) => r.data),
    issue: (nombre) => api.post<IssuedApiKey>(`/clients/${clientId}/api-keys`, { nombre }).then((r) => r.data),
    revoke: (id) => api.post<ApiKey>(`/clients/${clientId}/api-keys/${id}/revoke`).then((r) => r.data),
  };
}

/** URL base pública de la API de integración. */
export const INTEGRATION_API_BASE = 'https://docs.kuboti.com/api/v1/integracion';
