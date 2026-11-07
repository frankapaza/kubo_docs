import type { User, UserRole } from '../api/types';

export const ROLE_OPTIONS: UserRole[] = [
  'ADMIN',
  'PRODUCT_OWNER',
  'SCRUM_MASTER',
  'DEVELOPER',
  'STAKEHOLDER',
];

export const canManageUsers = (user: User | null): boolean => user?.role === 'ADMIN';

/**
 * Mantener el catálogo de sistemas: alta, renombrado, retirada y borrado. Solo
 * ADMIN, como las demás listas globales de la casa: el catálogo es la lista de
 * productos que la casa arrienda, y una fila mal puesta la heredan todos los
 * clientes.
 */
export const canManageSystemCatalog = (user: User | null): boolean => user?.role === 'ADMIN';

export const canCreateProject = (user: User | null): boolean =>
  user?.role === 'ADMIN' || user?.role === 'PRODUCT_OWNER';

/**
 * Asignar (o quitar) un sistema del catálogo a un cliente. Es un hecho de la
 * relación comercial, del mismo peso que editar su ficha, así que lleva la
 * misma guarda que ella: ADMIN o PRODUCT_OWNER (decisión 5 del diseño).
 */
export const canManageClientSystems = (user: User | null): boolean =>
  user?.role === 'ADMIN' || user?.role === 'PRODUCT_OWNER';

export const canApproveActa = (user: User | null): boolean =>
  user?.role === 'ADMIN' ||
  user?.role === 'PRODUCT_OWNER' ||
  user?.role === 'SCRUM_MASTER';

export const canManageProjectMembers = (user: User | null): boolean =>
  user?.role === 'ADMIN' || user?.role === 'PRODUCT_OWNER';
