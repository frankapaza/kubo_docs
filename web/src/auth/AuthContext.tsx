import {
  createContext, useContext, useEffect, useState, ReactNode,
} from 'react';
import { authApi } from '../api/auth.api';
import { TOKEN_STORAGE_KEY } from '../api/client';
import type { User } from '../api/types';

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
    authApi.me()
      .then(setUser)
      .catch(() => localStorage.removeItem(TOKEN_STORAGE_KEY))
      .finally(() => setLoading(false));
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
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fuera de <AuthProvider>');
  return c;
}
