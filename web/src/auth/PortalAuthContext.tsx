import {
  createContext, useContext, useEffect, useState, ReactNode,
} from 'react';
import { portalApi, PORTAL_TOKEN_STORAGE_KEY, PORTAL_REFRESH_TOKEN_KEY } from '../api/portal.api';
import type { PortalClientUser } from '../api/types';

/**
 * Contexto de sesión del portal de clientes, independiente del interno
 * (`AuthContext`): claves de `localStorage` distintas, sin leer ni escribir
 * las del panel interno, para que un cliente y un miembro del equipo puedan
 * tener sesión abierta a la vez en el mismo navegador sin pisarse.
 *
 * El backend del portal (`portal-auth.controller.ts`) solo expone `login` y
 * `refresh`, ninguno de los dos un `/me`: no hay forma de recuperar el
 * `clientUser` a partir del token sin volver a autenticar. Por eso se
 * persiste también el perfil (no solo el token) para poder restaurar la
 * sesión al recargar la página.
 */
const PORTAL_USER_STORAGE_KEY = 'kubo_portal_user';

interface PortalAuthCtx {
  clientUser: PortalClientUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<PortalAuthCtx | null>(null);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [clientUser, setClientUser] = useState<PortalClientUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(PORTAL_TOKEN_STORAGE_KEY);
    const storedUser = localStorage.getItem(PORTAL_USER_STORAGE_KEY);

    if (!token) {
      // Sin token no hay sesión válida; si quedó un perfil de una sesión
      // anterior (p.ej. tras el logout forzado del interceptor de 401), se
      // descarta para no arrastrar un estado a medias.
      if (storedUser) localStorage.removeItem(PORTAL_USER_STORAGE_KEY);
      setLoading(false);
      return;
    }

    if (storedUser) {
      try {
        setClientUser(JSON.parse(storedUser) as PortalClientUser);
      } catch {
        localStorage.removeItem(PORTAL_TOKEN_STORAGE_KEY);
        localStorage.removeItem(PORTAL_REFRESH_TOKEN_KEY);
        localStorage.removeItem(PORTAL_USER_STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const session = await portalApi.login(email, password);
    localStorage.setItem(PORTAL_TOKEN_STORAGE_KEY, session.accessToken);
    localStorage.setItem(PORTAL_REFRESH_TOKEN_KEY, session.refreshToken);
    localStorage.setItem(PORTAL_USER_STORAGE_KEY, JSON.stringify(session.clientUser));
    setClientUser(session.clientUser);
  };

  const logout = () => {
    localStorage.removeItem(PORTAL_TOKEN_STORAGE_KEY);
    localStorage.removeItem(PORTAL_REFRESH_TOKEN_KEY);
    localStorage.removeItem(PORTAL_USER_STORAGE_KEY);
    setClientUser(null);
  };

  return (
    <Ctx.Provider value={{ clientUser, loading, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePortalAuth(): PortalAuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePortalAuth fuera de <PortalAuthProvider>');
  return c;
}
