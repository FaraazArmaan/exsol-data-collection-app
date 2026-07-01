import { DomainPanel } from './DomainPanel';
import { useAnalytics } from '../hooks/useAnalytics';
import { domainExportUrl } from '../api';
import type { AnalyticsParams, DomainKey } from '../types';

// One domain's data-fetch + render lifecycle. Each section fetches independently
// so a slow domain never blocks the others.
export function DomainSection({ domain, title, params }: {
  domain: DomainKey;
  title: string;
  params: AnalyticsParams;
}) {
  const { data, loading, error } = useAnalytics(domain, params);

  if (loading) {
    return (
      <section className="analytics-panel">
        <h2>{title}</h2>
        <p className="analytics-loading">Loading…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="analytics-panel">
        <h2>{title}</h2>
        <p className="analytics-error">Couldn’t load {title.toLowerCase()} ({error}).</p>
      </section>
    );
  }
  if (!data) return null;
  return <DomainPanel title={title} data={data} exportHref={domainExportUrl(domain, params, 'xlsx')} />;
}
