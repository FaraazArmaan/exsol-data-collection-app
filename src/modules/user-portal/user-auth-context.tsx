import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  userMe, userLogout,
  type UserPortalUser, type UserPortalClient,
  type UserPortalPermissionMatrix, type UserPortalEnabledModule,
} from './api';

interface State {
  user: UserPortalUser | null;
  client: UserPortalClient | null;
  permissions: UserPortalPermissionMatrix;
  enabledModules: UserPortalEnabledModule[];
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<State | null>(null);

export function UserAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPortalUser | null>(null);
  const [client, setClient] = useState<UserPortalClient | null>(null);
  const [permissions, setPermissions] = useState<UserPortalPermissionMatrix>({});
  const [enabledModules, setEnabledModules] = useState<UserPortalEnabledModule[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const r = await userMe();
    if (r.ok) {
      setUser(r.data.user);
      setClient(r.data.client);
      setPermissions(r.data.permissions);
      setEnabledModules(r.data.enabled_modules);
    } else {
      setUser(null);
      setClient(null);
      setPermissions({});
      setEnabledModules([]);
    }
    setLoading(false);
  };

  const signOut = async () => {
    await userLogout();
    setUser(null);
    setClient(null);
    setPermissions({});
    setEnabledModules([]);
  };

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={{ user, client, permissions, enabledModules, loading, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useUserAuth(): State {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUserAuth outside UserAuthProvider');
  return v;
}
