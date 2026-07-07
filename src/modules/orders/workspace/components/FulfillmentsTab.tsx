// FulfillmentsTab — Split-merge Engine (Task 6).
//
// Three panels:
//   1. Split allocator  — pick an existing sale's lines and partition them into
//      named fulfillment groups with per-line qty allocation.  Over-allocation
//      is caught client-side before the API call.
//   2. Fulfillment list — shows all fulfillments for the client with per-row
//      advance buttons (pending→picked→packed→shipped→fulfilled or →cancelled).
//   3. Merge picker     — select two or more open same-customer sales and link
//      them into a merge group.
import { useEffect, useState, useCallback } from 'react';
import { ordersApi, OrdersApiError } from '../../shared/api';
import type { FulfillmentRow, FulfillmentStatus } from '../../shared/types';

interface Props {
  perms: ReadonlySet<string>;
}

const STATUS_LABEL: Record<FulfillmentStatus, string> = {
  pending:   'Pending',
  picked:    'Picked',
  packed:    'Packed',
  shipped:   'Shipped',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

const STATUS_NEXT: Partial<Record<FulfillmentStatus, FulfillmentStatus[]>> = {
  pending:  ['picked', 'cancelled'],
  picked:   ['packed', 'cancelled'],
  packed:   ['shipped', 'cancelled'],
  shipped:  ['fulfilled', 'cancelled'],
};

function humanError(e: unknown): string {
  if (e instanceof OrdersApiError) {
    if (e.status === 409 && e.code === 'over_fulfillment') return 'Over-allocation: assigned qty exceeds line qty.';
    if (e.status === 409 && e.code === 'insufficient_stock') return 'Insufficient stock to fulfil.';
    if (e.status === 409 && e.code === 'illegal_transition') return 'That transition is not allowed.';
    if (e.status === 409 && e.code === 'sale_not_open') return 'One or more sales are not open.';
    if (e.status === 409 && e.code === 'customer_mismatch') return 'Sales have different customer phones.';
    if (e.status === 412) return 'Orders module not enabled.';
    if (e.status === 403) return 'Permission denied.';
    if (e.status === 404) return 'Sale not found.';
    return `Error: ${e.code}`;
  }
  return 'Network error — please try again.';
}

// ── Fulfillment List Panel ────────────────────────────────────────────────────

interface FulfillmentListProps {
  canEdit: boolean;
}

function FulfillmentList({ canEdit }: FulfillmentListProps) {
  const [rows, setRows] = useState<FulfillmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState<Record<string, string | null>>({});
  const [advError, setAdvError] = useState<Record<string, string | null>>({});

  const load = useCallback(() => {
    setLoading(true);
    ordersApi
      .listFulfillments()
      .then((data) => { setRows(data); setError(null); })
      .catch((e) => { setError(humanError(e)); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const advance = async (id: string, to: FulfillmentStatus) => {
    setAdvancing((prev) => ({ ...prev, [id]: to }));
    setAdvError((prev) => ({ ...prev, [id]: null }));
    try {
      await ordersApi.advanceFulfillment(id, to);
      load();
    } catch (e) {
      setAdvError((prev) => ({ ...prev, [id]: humanError(e) }));
    } finally {
      setAdvancing((prev) => ({ ...prev, [id]: null }));
    }
  };

  if (loading) return <p className="ord-muted">Loading fulfillments…</p>;
  if (error) return <p className="ord-error">{error}</p>;
  if (rows.length === 0) return <p className="ord-muted">No fulfillments yet. Use Split to create one.</p>;

  return (
    <table className="ord-table">
      <thead>
        <tr>
          <th>Label</th>
          <th>Status</th>
          <th>Lines</th>
          <th>Fulfilled</th>
          {canEdit && <th>Actions</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => {
          const nextOptions = STATUS_NEXT[f.status] ?? [];
          const isAdvancing = advancing[f.id] != null;
          const rowError = advError[f.id];
          return (
            <tr key={f.id}>
              <td>{f.label}</td>
              <td>
                <span className={`ord-badge ord-badge-${f.status}`}>
                  {STATUS_LABEL[f.status]}
                </span>
              </td>
              <td className="ord-num">{f.lines.length}</td>
              <td>{f.fulfilled_at ? new Date(f.fulfilled_at).toLocaleString() : '—'}</td>
              {canEdit && (
                <td className="ord-actions">
                  {rowError && <span className="ord-form-error">{rowError}</span>}
                  {nextOptions.map((to) => (
                    <button
                      key={to}
                      className={`ord-btn ord-btn-sm${to === 'cancelled' ? '' : ' ord-btn-primary'}`}
                      disabled={isAdvancing}
                      onClick={() => advance(f.id, to)}
                    >
                      {isAdvancing && advancing[f.id] === to ? '…' : `→ ${STATUS_LABEL[to]}`}
                    </button>
                  ))}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Split Allocator Panel ─────────────────────────────────────────────────────

interface SplitLine {
  sale_line_id: string;
  product_name_snap: string;
  line_qty: number;
}

interface FulfillmentDraft {
  label: string;
  allocs: Record<string, number>; // sale_line_id → qty
}

function SplitPanel({ onDone }: { onDone: () => void }) {
  const [saleId, setSaleId] = useState('');
  const [saleLines, setSaleLines] = useState<SplitLine[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<FulfillmentDraft[]>([{ label: 'Box 1', allocs: {} }]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadSale = async () => {
    setLoadError(null);
    setSaleLines(null);
    try {
      // Use the dedicated sale-lines endpoint so fresh (never-split) sales show
      // their allocatable lines immediately, not an empty list derived from
      // fulfillments (which is empty until the first split has been created).
      const result = await ordersApi.saleLines(saleId.trim());
      setSaleLines(result.lines.map((l) => ({
        sale_line_id: l.id,
        product_name_snap: l.product_name_snap,
        line_qty: l.qty,
      })));
    } catch (e) {
      setLoadError(humanError(e));
    }
  };

  // Client-side over-allocation guard.
  const overAllocated = (lineId: string): boolean => {
    const line = saleLines?.find((l) => l.sale_line_id === lineId);
    if (!line) return false;
    const total = drafts.reduce((sum, d) => sum + (d.allocs[lineId] ?? 0), 0);
    return total > line.line_qty;
  };

  const setAlloc = (draftIdx: number, lineId: string, qty: number) => {
    setDrafts((prev) => {
      const next = [...prev];
      next[draftIdx] = { ...next[draftIdx]!, allocs: { ...next[draftIdx]!.allocs, [lineId]: qty } };
      return next;
    });
  };

  const addFulfillment = () =>
    setDrafts((prev) => [...prev, { label: `Box ${prev.length + 1}`, allocs: {} }]);
  const removeFulfillment = (idx: number) =>
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  const setLabel = (idx: number, label: string) =>
    setDrafts((prev) => { const next = [...prev]; next[idx] = { ...next[idx]!, label }; return next; });

  const submit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const payload = drafts.map((d) => ({
        label: d.label,
        lines: Object.entries(d.allocs)
          .filter(([, qty]) => qty > 0)
          .map(([sale_line_id, qty]) => ({ sale_line_id, qty })),
      })).filter((f) => f.lines.length > 0);
      if (payload.length === 0) { setSubmitError('No allocations entered.'); return; }
      await ordersApi.splitSale(saleId.trim(), payload);
      onDone();
    } catch (e) {
      setSubmitError(humanError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const hasOverAlloc = saleLines?.some((l) => overAllocated(l.sale_line_id)) ?? false;

  return (
    <div>
      <div className="ord-form-row">
        <input
          className="ord-input"
          placeholder="Sale UUID"
          value={saleId}
          onChange={(e) => setSaleId(e.target.value)}
        />
        <button className="ord-btn ord-btn-primary" onClick={loadSale} disabled={!saleId.trim()}>
          Load Sale Lines
        </button>
      </div>
      {loadError && <p className="ord-form-error">{loadError}</p>}

      {saleLines !== null && (
        <>
          {saleLines.length === 0 ? (
            <p className="ord-muted">No sale lines found for this sale.</p>
          ) : (
            <>
              {drafts.map((draft, dIdx) => (
                <div key={dIdx} style={{ marginBottom: '1rem', padding: '0.75rem', border: '1px solid var(--border-default)', borderRadius: '6px' }}>
                  <div className="ord-form-row">
                    <input
                      className="ord-input"
                      placeholder={`Fulfillment label (e.g. Box ${dIdx + 1})`}
                      value={draft.label}
                      onChange={(e) => setLabel(dIdx, e.target.value)}
                    />
                    {drafts.length > 1 && (
                      <button className="ord-btn ord-btn-sm" onClick={() => removeFulfillment(dIdx)}>
                        Remove
                      </button>
                    )}
                  </div>
                  {saleLines.map((line) => {
                    const allocated = draft.allocs[line.sale_line_id] ?? 0;
                    const over = overAllocated(line.sale_line_id);
                    return (
                      <div key={line.sale_line_id} className="ord-form-row" style={{ alignItems: 'center' }}>
                        <span style={{ flex: 1 }}>{line.product_name_snap} (qty: {line.line_qty})</span>
                        <input
                          type="number"
                          min={0}
                          max={line.line_qty}
                          className="ord-input"
                          style={{ width: '80px', borderColor: over ? 'var(--danger)' : undefined }}
                          value={allocated || ''}
                          onChange={(e) => setAlloc(dIdx, line.sale_line_id, Number(e.target.value))}
                        />
                        {over && <span className="ord-form-error">Over</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
              <div className="ord-actions">
                <button className="ord-btn ord-btn-sm" onClick={addFulfillment}>+ Add Fulfillment</button>
                {submitError && <span className="ord-form-error">{submitError}</span>}
                <button
                  className="ord-btn ord-btn-primary"
                  onClick={submit}
                  disabled={submitting || hasOverAlloc}
                >
                  {submitting ? 'Splitting…' : 'Create Split'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Merge Picker Panel ────────────────────────────────────────────────────────

function MergePanel({ onDone }: { onDone: () => void }) {
  const [primaryId, setPrimaryId] = useState('');
  const [secondaryIds, setSecondaryIds] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successGroupId, setSuccessGroupId] = useState<string | null>(null);

  const submit = async () => {
    setSubmitError(null);
    setSuccessGroupId(null);
    setSubmitting(true);
    try {
      const allIds = [primaryId.trim(), ...secondaryIds.split(',').map((s) => s.trim()).filter(Boolean)];
      const { group_id } = await ordersApi.mergeSales(primaryId.trim(), allIds);
      setSuccessGroupId(group_id);
      onDone();
    } catch (e) {
      setSubmitError(humanError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ord-form">
      <div className="ord-form-row">
        <label style={{ minWidth: 120, color: 'var(--text-secondary)' }}>Primary Sale ID</label>
        <input
          className="ord-input"
          placeholder="Primary sale UUID"
          value={primaryId}
          onChange={(e) => setPrimaryId(e.target.value)}
        />
      </div>
      <div className="ord-form-row">
        <label style={{ minWidth: 120, color: 'var(--text-secondary)' }}>Other Sale IDs</label>
        <input
          className="ord-input"
          placeholder="Comma-separated UUIDs (incl. primary or just others)"
          value={secondaryIds}
          onChange={(e) => setSecondaryIds(e.target.value)}
        />
      </div>
      <p className="ord-muted" style={{ margin: '0 0 0.5rem' }}>
        All sales must be open (pending/paid) and share the same customer phone as the primary.
      </p>
      {submitError && <p className="ord-form-error">{submitError}</p>}
      {successGroupId && <p style={{ color: 'var(--success)' }}>Merge group created: {successGroupId}</p>}
      <div className="ord-actions">
        <button
          className="ord-btn ord-btn-primary"
          onClick={submit}
          disabled={submitting || !primaryId.trim()}
        >
          {submitting ? 'Merging…' : 'Create Merge Group'}
        </button>
      </div>
    </div>
  );
}

// ── Main Tab ──────────────────────────────────────────────────────────────────

type SubTab = 'list' | 'split' | 'merge';

export default function FulfillmentsTab({ perms }: Props) {
  const canEdit = perms.has('orders.business.edit');
  const [sub, setSub] = useState<SubTab>('list');
  const [refreshKey, setRefreshKey] = useState(0);

  const done = () => { setRefreshKey((k) => k + 1); setSub('list'); };

  return (
    <div>
      <div className="ord-tabs" style={{ marginBottom: '1rem' }}>
        <button
          className={`ord-tab${sub === 'list' ? ' ord-tab-active' : ''}`}
          onClick={() => setSub('list')}
        >
          Fulfillments
        </button>
        {canEdit && (
          <button
            className={`ord-tab${sub === 'split' ? ' ord-tab-active' : ''}`}
            onClick={() => setSub('split')}
          >
            Split Sale
          </button>
        )}
        {canEdit && (
          <button
            className={`ord-tab${sub === 'merge' ? ' ord-tab-active' : ''}`}
            onClick={() => setSub('merge')}
          >
            Merge Orders
          </button>
        )}
      </div>

      {sub === 'list' && <FulfillmentList key={refreshKey} canEdit={canEdit} />}
      {sub === 'split' && canEdit && <SplitPanel onDone={done} />}
      {sub === 'merge' && canEdit && <MergePanel onDone={done} />}
    </div>
  );
}
