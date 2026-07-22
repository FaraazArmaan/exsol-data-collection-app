import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { inventoryApi } from '../../shared/api';
import type { InventoryReturn, ReturnDisposition, StockRow } from '../../shared/types';
import { InventoryTabs } from '../components/InventoryTabs';
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '../../../../components/ui/Feedback';
import { Button } from '../../../../components/ui/Button';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

const DISP_LABEL: Record<ReturnDisposition, string> = { restock: 'Restocked', writeoff: 'Written off' };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Returns & RMA. Intake form (restock or write-off) + a return ledger. Every
// state handled; the form self-guards on the empty-product case.
export default function ReturnsPage({ perms }: Props) {
  const [returns, setReturns] = useState<InventoryReturn[] | null>(null);
  const [products, setProducts] = useState<StockRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('1');
  const [disposition, setDisposition] = useState<ReturnDisposition>('restock');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const canCreate = perms.has('inventory.products.edit');

  const load = useCallback(() => {
    setError(null);
    inventoryApi.listReturns().then((r) => setReturns(r.returns)).catch((e) => { setReturns([]); setError(msg(e)); });
    inventoryApi.list('').then((r) => setProducts(r.items)).catch(() => setProducts([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const qn = Number(qty);
    if (!productId || !Number.isInteger(qn) || qn <= 0 || busy) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await inventoryApi.createReturn({ product_id: productId, qty: qn, disposition, reason: reason.trim() });
      setFlash(disposition === 'restock' ? 'Return logged — stock restocked.' : 'Return logged — written off.');
      setProductId('');
      setQty('1');
      setReason('');
      setReturns(null);
      load();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inv-shell">
      <div className="inv-header"><h1 className="inv-title">Inventory</h1></div>
      <InventoryTabs />

      {error && <ErrorState title="Returns could not load" action={<Button variant="secondary" onClick={load}>Try again</Button>}>{error}</ErrorState>}
      {flash && <InlineNotice tone="success" title="Return logged">{flash}</InlineNotice>}

      {canCreate && (
        <form className="inv-return-form" onSubmit={submit}>
          <h2 className="inv-dash-h2">Log a return</h2>
          {products.length === 0 ? (
            <p className="inv-muted">No stock-tracked products to return yet.</p>
          ) : (
            <div className="inv-return-row">
              <select value={productId} onChange={(e) => setProductId(e.target.value)} aria-label="Product">
                <option value="">Select a product…</option>
                {products.map((p) => (
                  <option key={p.product_id} value={p.product_id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>
                ))}
              </select>
              <input
                className="inv-num" type="number" min="1" step="1" value={qty}
                onChange={(e) => setQty(e.target.value)} aria-label="Quantity"
              />
              <select value={disposition} onChange={(e) => setDisposition(e.target.value as ReturnDisposition)} aria-label="Disposition">
                <option value="restock">Restock</option>
                <option value="writeoff">Write off</option>
              </select>
              <input
                type="text" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)" aria-label="Reason"
              />
              <button type="submit" className="btn btn-primary" disabled={busy || !productId}>
                {busy ? 'Saving…' : 'Log return'}
              </button>
            </div>
          )}
        </form>
      )}

      {error ? null : returns === null ? (
        <LoadingState title="Loading returns" />
      ) : returns.length === 0 ? (
        <EmptyState title="No returns logged yet." />
      ) : (
        <table className="inv-table">
          <thead>
            <tr>
              <th>Product</th><th className="inv-num">Qty</th><th>Disposition</th><th>Reason</th><th>Date</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((r) => (
              <tr key={r.id}>
                <td>{r.product_name}</td>
                <td className="inv-num">{r.qty}</td>
                <td>
                  <span className={`inv-badge inv-badge-${r.disposition === 'restock' ? 'ok' : 'low'}`}>
                    {DISP_LABEL[r.disposition]}
                  </span>
                </td>
                <td className="inv-muted">{r.reason ?? '—'}</td>
                <td className="inv-muted">{new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
