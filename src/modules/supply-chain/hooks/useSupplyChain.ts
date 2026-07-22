import { useCallback, useEffect, useState } from 'react';
import { fetchSection } from '../shared/api';
import type { SectionKey } from '../shared/types';

interface State<T> { data: T | null; loading: boolean; error: string | null; reload: () => void; }

export function useSupplyChain<T>(section: SectionKey): State<T> {
  const [state, setState] = useState<Omit<State<T>, 'reload'>>({ data: null, loading: true, error: null });
  const [request, setRequest] = useState(0);
  const reload = useCallback(() => setRequest((value) => value + 1), []);
  useEffect(() => {
    let alive = true;
    setState({ data: null, loading: true, error: null });
    fetchSection<T>(section)
      .then((d) => { if (alive) setState({ data: d, loading: false, error: null }); })
      .catch((e) => { if (alive) setState({ data: null, loading: false, error: String(e?.message ?? e) }); });
    return () => { alive = false; };
  }, [section, request]);
  return { ...state, reload };
}
