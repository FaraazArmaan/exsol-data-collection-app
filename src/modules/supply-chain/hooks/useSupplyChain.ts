import { useEffect, useState } from 'react';
import { fetchSection } from '../api';
import type { SectionKey } from '../types';

interface State<T> { data: T | null; loading: boolean; error: string | null; }

export function useSupplyChain<T>(section: SectionKey): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    setState({ data: null, loading: true, error: null });
    fetchSection<T>(section)
      .then((d) => { if (alive) setState({ data: d, loading: false, error: null }); })
      .catch((e) => { if (alive) setState({ data: null, loading: false, error: String(e?.message ?? e) }); });
    return () => { alive = false; };
  }, [section]);
  return state;
}
