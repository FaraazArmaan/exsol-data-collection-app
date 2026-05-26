import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from './api-client';

export interface Admin {
  id: string;
  email: string;
  display_name: string;
  is_bootstrap: boolean;
}

interface AuthState {
  admin: Admin | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const r = await apiFetch<{ admin: Admin }>('/api/auth-me');
    setAdmin(r.ok ? r.data.admin : null);
    setLoading(false);
  };

  const signOut = async () => {
    await apiFetch('/api/auth-logout', { method: 'POST' });
    setAdmin(null);
  };

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={{ admin, loading, refresh, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
