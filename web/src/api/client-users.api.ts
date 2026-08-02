import { api } from './client';

/**
 * Proyección que expone `GET/POST/PATCH /client-users` (ver
 * `backend/src/modules/portal/dto/client-user.dto.ts:ClientUserView`). Nunca
 * trae `passwordHash`: el backend no lo publica bajo ninguna circunstancia.
 */
export interface ClientUser {
  id: number;
  clientId: number;
  email: string;
  fullName: string;
  isAdmin: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Alta de un usuario de cliente. El `clientId` viaja aquí porque la ruta es
 * plana (`POST /client-users`) y porque es el único momento en que se fija:
 * `UpdateClientUserBody` no lo admite a propósito, igual que
 * `UpdateClientUserDto` en el backend.
 */
export interface CreateClientUserBody {
  clientId: number;
  email: string;
  password: string;
  fullName: string;
  isAdmin?: boolean;
}

/**
 * Deliberadamente SIN `clientId`: mover a alguien de empresa no es un campo
 * editable en P1, se hace borrando y creando de nuevo. Refleja
 * `UpdateClientUserDto` campo por campo.
 */
export interface UpdateClientUserBody {
  fullName?: string;
  isActive?: boolean;
  isAdmin?: boolean;
  password?: string;
}

export const clientUsersApi = {
  /** El listado siempre se pide acotado a un cliente; no existe un "todos". */
  listByClient: (clientId: number) =>
    api.get<ClientUser[]>('/client-users', { params: { clientId } }).then((r) => r.data),

  /** Requiere rol ADMIN en el backend (`@Roles('ADMIN')`); un rol menor recibe 403. */
  create: (body: CreateClientUserBody) =>
    api.post<ClientUser>('/client-users', body).then((r) => r.data),

  /** Requiere rol ADMIN en el backend, igual que `create`. */
  update: (id: number, body: UpdateClientUserBody) =>
    api.patch<ClientUser>(`/client-users/${id}`, body).then((r) => r.data),
};
