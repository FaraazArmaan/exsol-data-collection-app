import { useEffect, useState } from 'react';
import { fetchDomain, fetchOverview } from '../shared/api';
import type { AnalyticsParams, DomainKey } from '../shared/types';

interface State<T> { data: T | null; loading: boolean; error: string | null }

// Fetches one domain (or the overview) for the given params. Re-fetches whenever
// the domain or params change; ignores stale responses via the `alive` guard.
export function useAnalytics(domain: DomainKey | 'overview', params: AnalyticsParams) {
  const [state, setState] = useState<State<any>>({ data: null, loading: true, error: null });
  const key = JSON.stringify({ domain, params });

  useEffect(() => {
    let alive = true;
    setState({ data: null, loading: true, error: null });
    const call = domain === 'overview' ? fetchOverview(params) : fetchDomain(domain, params);
    call
      .then((d) => { if (alive) setState({ data: d, loading: false, error: null }); })
      .catch((e) => { if (alive) setState({ data: null, loading: false, error: String(e?.message ?? e) }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
