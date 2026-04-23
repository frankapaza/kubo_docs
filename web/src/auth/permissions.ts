import type { User, UserRole } from '../api/types';

export const ROLE_OPTIONS: UserRole[] = [
  'ADMIN',
  'PRODUCT_OWNER',
  'SCRUM_MASTER',
  'DEVELOPER',
  'STAKEHOLDER',
];

export const canManageUsers = (user: User | null): boolean => user?.role === 'ADMIN';

export const canCreateProject = (user: User | null): boolean =>
  user?.role === 'ADMIN' || user?.role === 'PRODUCT_OWNER';

export const canApproveActa = (user: User | null): boolean =>
  user?.role === 'ADMIN' ||
  user?.role === 'PRODUCT_OWNER' ||
  user?.role === 'SCRUM_MASTER';

export const canManageProjectMembers = (user: User | null): boolean =>
  user?.role === 'ADMIN' || user?.role === 'PRODUCT_OWNER';
