import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { userMe, userLogout, type UserPortalUser, type UserPortalClient } from './api';

interface State {
  user: UserPortalUser | null;
  client: UserPortalClient | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<State | null>(null);

export function UserAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPortalUser | null>(null);
  const [client, setClient] = useState<UserPortalClient | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const r = await userMe();
    if (r.ok) { setUser(r.data.user); setClient(r.data.client); }
    else { setUser(null); setClient(null); }
    setLoading(false);
  };

  const signOut = async () => {
    await userLogout();
    setUser(null);
    setClient(null);
  };

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={{ user, client, loading, refresh, signOut }}>{children}</Ctx.Provider>;
}

export function useUserAuth(): State {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUserAuth outside UserAuthProvider');
  return v;
}
