import type { ProductStatus, ProductListResponse } from '../../shared/types';

export type StatusFilter = ProductStatus | 'all';

export function ProductStatusTabs(props: {
  active: StatusFilter;
  counts: ProductListResponse['counts'];
  onChange: (s: StatusFilter) => void;
}) {
  const { active, counts, onChange } = props;

  const tab = (key: StatusFilter, label: string, n: number) => (
    <button
      key={key}
      type="button"
      className={`pm-tab${active === key ? ' pm-tab-active' : ''}`}
      aria-pressed={active === key}
      onClick={() => onChange(key)}
    >
      {label} <span className="pm-tab-count">{n}</span>
    </button>
  );

  return (
    <div className="pm-tabs" role="tablist" aria-label="Product status">
      {tab('all',      'All',      counts.all)}
      {tab('active',   'Active',   counts.active)}
      {tab('draft',    'Draft',    counts.draft)}
      {tab('archived', 'Archived', counts.archived)}
    </div>
  );
}
