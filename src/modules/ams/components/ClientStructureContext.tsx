import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getClientStructure, type ClientStructure } from '../api';

interface State {
  structure: ClientStructure | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<State | null>(null);

export function ClientStructureProvider({ clientId, children }: { clientId: string; children: ReactNode }) {
  const [structure, setStructure] = useState<ClientStructure | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await getClientStructure(clientId);
    setLoading(false);
    if (!r.ok) { setError(`Failed to load structure (${r.error.code})`); return; }
    setStructure(r.data);
  }, [clientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return <Ctx.Provider value={{ structure, loading, error, refresh }}>{children}</Ctx.Provider>;
}

export function useClientStructure(): State {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClientStructure outside provider');
  return v;
}
