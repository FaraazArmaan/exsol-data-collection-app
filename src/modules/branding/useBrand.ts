import { useEffect, useState } from 'react';
import type { Brand } from './types';

export function useBrand(slug: string | null | undefined): {
  brand: Brand | null;
  loading: boolean;
  error: string | null;
} {
  const [state, setState] = useState<{ brand: Brand | null; loading: boolean; error: string | null }>({
    brand: null, loading: !!slug, error: null,
  });
  useEffect(() => {
    if (!slug) { setState({ brand: null, loading: false, error: null }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(`/api/public/brand/${encodeURIComponent(slug)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((brand: Brand) => { if (!cancelled) setState({ brand, loading: false, error: null }); })
      .catch((e: Error) => { if (!cancelled) setState({ brand: null, loading: false, error: e.message }); });
    return () => { cancelled = true; };
  }, [slug]);
  return state;
}
