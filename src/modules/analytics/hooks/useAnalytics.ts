import { useEffect, useState } from 'react';
import { fetchSales, fetchOverview } from '../api';
import type { AnalyticsParams } from '../types';

interface State<T> { data: T | null; loading: boolean; error: string | null }

export function useAnalytics(domain: 'sales' | 'overview', params: AnalyticsParams) {
  const [state, setState] = useState<State<any>>({ data: null, loading: true, error: null });
  const key = JSON.stringify({ domain, params });

  useEffect(() => {
    let alive = true;
    setState({ data: null, loading: true, error: null });
    const call = domain === 'sales' ? fetchSales(params) : fetchOverview(params);
    call
      .then((d) => { if (alive) setState({ data: d, loading: false, error: null }); })
      .catch((e) => { if (alive) setState({ data: null, loading: false, error: String(e?.message ?? e) }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
