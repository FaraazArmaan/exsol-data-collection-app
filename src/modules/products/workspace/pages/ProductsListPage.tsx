import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { productsApi, categoriesApi } from '../../shared/api';
import type {
  ProductCategory, ProductFilters, ProductListResponse, ProductStatus, ProductType,
} from '../../shared/types';
import {
  canCreateProducts, canDeleteProducts, canEditProducts, canViewProducts,
  canManageCategories,
} from '../../shared/permissions';
import { useProductsScope } from '../../shared/scope';
import { ProductStatusTabs, type StatusFilter } from '../components/ProductStatusTabs';
import { ProductFiltersBar } from '../components/ProductFiltersBar';
import { ProductBulkBar } from '../components/ProductBulkBar';
import { ProductTable } from '../components/ProductTable';
import { ProductTablePager } from '../components/ProductTablePager';
import { ProductImportModal } from '../components/ProductImportModal';
import { OnboardingLinkButton } from '../../../data-collection/OnboardingLinkButton';
import { Button } from '../../../../components/ui/Button';
import { ErrorState, InlineNotice } from '../../../../components/ui/Feedback';
import { TableLoadingState } from '../../../../components/ui/Table';

const POLL_MS = 5_000;
const PAGE_SIZE = 20;

const EMPTY_COUNTS: ProductListResponse['counts'] = { all: 0, active: 0, draft: 0, archived: 0 };

export default function ProductsListPage() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [search, setSearch] = useSearchParams();
  const scope = useProductsScope();
  const { permissions, levelNumber, queryParam: clientQuery } = scope;
  const basePath = `/c/${slug}/products`;

  const filters: ProductFilters = useMemo(() => {
    const status = (search.get('status') as StatusFilter | null) ?? 'all';
    const type = (search.get('type') as ProductType | null) ?? undefined;
    return {
      status,
      type: type ?? undefined,
      category_id: search.get('category_id') ?? undefined,
      brand: search.get('brand') ?? undefined,
      q: search.get('q') ?? undefined,
      page: Math.max(1, parseInt(search.get('page') ?? '1', 10) || 1),
      page_size: PAGE_SIZE,
    };
  // re-derive whenever the query string changes
  }, [search]);

  const [data, setData] = useState<ProductListResponse | null>(null);
  const [cats, setCats] = useState<ProductCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);

  // Refs let the polling callback always see the latest filters without restarting timers.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const load = useCallback(async () => {
    try {
      const [list, c] = await Promise.all([
        productsApi.list(filtersRef.current, { clientId: clientQuery }),
        categoriesApi.list({ clientId: clientQuery }),
      ]);
      setData(list);
      setCats(c.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [clientQuery]);

  // Reload on filter change + start polling.
  useEffect(() => {
    let alive = true;
    void load();
    const id = window.setInterval(() => { if (alive) void load(); }, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [load, filters]);

  if (!canViewProducts(permissions, levelNumber)) {
    return <p className="page page-canvas pm-shell pm-muted">You don't have access to Products.</p>;
  }

  const editAllowed   = canEditProducts(permissions, levelNumber);
  const createAllowed = canCreateProducts(permissions, levelNumber);
  const deleteAllowed = canDeleteProducts(permissions, levelNumber);
  const catsAllowed   = canManageCategories(permissions, levelNumber);

  function update(next: Partial<ProductFilters>) {
    const merged = new URLSearchParams(search);
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '' || (k === 'status' && v === 'all')) merged.delete(k);
      else merged.set(k, String(v));
    }
    // Reset page on any non-page filter change.
    if (!('page' in next)) merged.delete('page');
    setSearch(merged, { replace: true });
  }

  const catsById = new Map(cats.map((c) => [c.id, c.name]));

  async function bulkSetStatus(value: ProductStatus) {
    if (selected.size === 0) return;
    try {
      await productsApi.bulk({ ids: Array.from(selected), action: 'set_status', value }, { clientId: clientQuery });
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function archiveOne(id: string) {
    if (!confirm('Archive this product?')) return;
    try {
      await productsApi.remove(id, { clientId: clientQuery });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="page page-canvas pm-shell">
      <div className="pm-header">
        <div>
          <h1>Product Manager</h1>
          <p className="pm-muted">Catalog of products &amp; services for this workspace.</p>
        </div>
        {catsAllowed && (
          <a className="pm-link" href={`${basePath}/categories`}>Manage categories →</a>
        )}
        {/* Data Collection recombination: self-gates on the data-collection module. */}
        <OnboardingLinkButton />
      </div>

      {error && !data ? <ErrorState title="Could not load products." action={<Button size="compact" onClick={() => void load()}>Try again</Button>}>{error}</ErrorState> : null}
      {error && data ? <InlineNotice tone="danger" title="Some product changes could not be completed." action={<Button size="compact" variant="quiet" onClick={() => setError(null)}>Dismiss</Button>}>{error}</InlineNotice> : null}

      <ProductStatusTabs
        active={(filters.status ?? 'all') as StatusFilter}
        counts={data?.counts ?? EMPTY_COUNTS}
        onChange={(s) => update({ status: s })}
      />

      {data && (
        <section className="pm-catalog-scan" aria-label="Catalog health">
          <div className="pm-catalog-stats">
            <div><strong>{data.counts.all}</strong><span>Products</span></div>
            <div><strong>{data.counts.active}</strong><span>Active</span></div>
            <div><strong>{data.counts.draft}</strong><span>Drafts</span></div>
            <div><strong>{data.total}</strong><span>Matching results</span></div>
          </div>
          {data.counts.draft > 0 && (
            <div className="pm-catalog-attention">
              <div><strong>Needs attention</strong><span>{data.counts.draft} draft product{data.counts.draft === 1 ? '' : 's'} need review before publishing.</span></div>
              <Button size="compact" variant="secondary" onClick={() => update({ status: 'draft' })}>Review drafts</Button>
            </div>
          )}
        </section>
      )}

      <ProductFiltersBar
        filters={filters}
        categories={cats}
        canEdit={editAllowed}
        canCreate={createAllowed}
        onChange={(next) => update(next)}
        onExport={(format) => {
          window.location.href = productsApi.exportUrl(filters, format, { clientId: clientQuery });
        }}
        onImport={() => setImportOpen(true)}
        onAdd={() => nav(`${basePath}/new`)}
      />

      <ProductBulkBar
        count={selected.size}
        canEdit={editAllowed}
        canDelete={deleteAllowed}
        onSetStatus={bulkSetStatus}
        onClear={() => setSelected(new Set())}
      />

      {!data && !error ? <TableLoadingState title="Loading products…" /> : null}
      {data ? <><ProductTable
        items={data?.items ?? []}
        selected={selected}
        basePath={basePath}
        canEdit={editAllowed}
        canDelete={deleteAllowed}
        startIndex={((data?.page ?? 1) - 1) * (data?.page_size ?? PAGE_SIZE)}
        categoriesById={catsById}
        onToggleSelect={(id) => setSelected((s) => {
          const n = new Set(s);
          if (n.has(id)) n.delete(id); else n.add(id);
          return n;
        })}
        onToggleAll={() => setSelected((s) => {
          if (!data || data.items.length === 0) return s;
          const allOn = data.items.every((p) => s.has(p.id));
          return new Set(allOn ? [] : data.items.map((p) => p.id));
        })}
        onEdit={(id) => nav(`${basePath}/${id}/edit`)}
        onDelete={archiveOne}
      />

      <ProductTablePager
        page={data?.page ?? 1}
        pageSize={data?.page_size ?? PAGE_SIZE}
        total={data?.total ?? 0}
        onPage={(n) => update({ page: n })}
      /></> : null}

      <ProductImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => { setImportOpen(false); void load(); }}
      />
    </div>
  );
}
