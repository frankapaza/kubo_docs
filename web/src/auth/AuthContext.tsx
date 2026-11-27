import {
  createContext, useContext, useEffect, useState, ReactNode,
} from 'react';
import { authApi } from '../api/auth.api';
import { isSessionExpiredError, TOKEN_STORAGE_KEY } from '../api/client';
import type { User } from '../api/types';
import { disconnectRealtime } from '../lib/realtime';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (body: { email: string; password: string; fullName: string }) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    // Al abrir la web el backend puede estar reiniciando (despliegue) o sin
    // red: eso no es una sesión caducada. Se reintenta cada 5 s sin borrar los
    // tokens; solo un rechazo real (4xx tras intentar renovar) deja sin sesión.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loadMe = () => {
      authApi.me()
        .then((u) => {
          if (cancelled) return;
          setUser(u);
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          if (isSessionExpiredError(err)) {
            localStorage.removeItem(TOKEN_STORAGE_KEY);
            setLoading(false);
          } else {
            timer = setTimeout(loadMe, 5000);
          }
        });
    };
    loadMe();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const login = async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    localStorage.setItem(TOKEN_STORAGE_KEY, res.accessToken);
    localStorage.setItem('kubo.refreshToken', res.refreshToken);
    setUser(res.user);
  };

  const register = async (body: { email: string; password: string; fullName: string }) => {
    const res = await authApi.register(body);
    localStorage.setItem(TOKEN_STORAGE_KEY, res.accessToken);
    localStorage.setItem('kubo.refreshToken', res.refreshToken);
    setUser(res.user);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem('kubo.refreshToken');
    disconnectRealtime();
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fuera de <AuthProvider>');
  return c;
}
