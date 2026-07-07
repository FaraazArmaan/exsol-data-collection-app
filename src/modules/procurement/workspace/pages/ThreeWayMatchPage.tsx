import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { procurementApi } from '../../shared/api';
import type { PurchaseOrderRow, ThreeWayMatch } from '../../shared/types';
import { formatMoney, STATUS_LABEL } from '../../shared/format';
import { ProcurementTabs } from '../ProcurementTabs';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// 3-way match screen: pick an ordered PO, record the goods receipt + supplier
// invoice, see the ordered-vs-received / total-vs-invoiced comparison, and
// confirm a clean match — which creates the Finance expense.
export default function ThreeWayMatchPage({ perms }: Props) {
  const [orders, setOrders] = useState<PurchaseOrderRow[] | null>(null);
  const [poId, setPoId] = useState('');
  const [match, setMatch] = useState<ThreeWayMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [grnQty, setGrnQty] = useState<Record<string, string>>({});
  const [invNumber, setInvNumber] = useState('');
  const [invAmount, setInvAmount] = useState('');

  const canEdit = perms.has('procurement.products.edit');

  useEffect(() => {
    procurementApi.listOrders()
      .then((r) => setOrders(r.orders.filter((o) => o.status === 'ordered' || o.status === 'received')))
      .catch((e) => { setOrders([]); setError(msg(e)); });
  }, []);

  const loadMatch = useCallback((id: string) => {
    if (!id) { setMatch(null); return; }
    setError(null);
    procurementApi.getMatch(id)
      .then((m) => {
        setMatch(m);
        const g: Record<string, string> = {};
        for (const l of m.lines) g[l.product_id] = String(l.ordered_qty);
        setGrnQty(g);
        setInvAmount((m.po_total_cents / 100).toFixed(2));
      })
      .catch((e) => { setMatch(null); setError(msg(e)); });
  }, []);

  const onSelectPo = (id: string) => { setPoId(id); setFlash(null); loadMatch(id); };

  const recordGrn = async (e: FormEvent) => {
    e.preventDefault();
    if (!poId || !match || busy) return;
    const items = match.lines
      .map((l) => ({ product_id: l.product_id, qty_received: Math.trunc(Number(grnQty[l.product_id] ?? '0')) }))
      .filter((it) => it.qty_received > 0);
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await procurementApi.createGrn({ purchase_order_id: poId, items });
      loadMatch(poId);
    } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  };

  const recordInvoice = async (e: FormEvent) => {
    e.preventDefault();
    if (!poId || !invNumber.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await procurementApi.createInvoice({
        purchase_order_id: poId, invoice_number: invNumber.trim(),
        amount_cents: Math.max(0, Math.round(Number(invAmount || '0') * 100)),
      });
      setInvNumber('');
      loadMatch(poId);
    } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!poId || busy) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const r = await procurementApi.confirmMatch(poId);
      setFlash(`Matched — Finance expense created for ${formatMoney(r.amount_cents)}.`);
      loadMatch(poId);
    } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  };

  return (
    <div className="proc-shell">
      <div className="proc-header"><h1 className="proc-title">Procurement</h1></div>
      <ProcurementTabs />

      {error && (
        <div className="proc-error" role="alert">{error} <button type="button" className="proc-link" onClick={() => setError(null)}>dismiss</button></div>
      )}
      {flash && <div className="proc-flash" role="status">{flash}</div>}

      <label className="proc-field">
        <span>Purchase order</span>
        <select value={poId} onChange={(e) => onSelectPo(e.target.value)} aria-label="Purchase order">
          <option value="">Select an ordered / received PO…</option>
          {(orders ?? []).map((o) => (
            <option key={o.id} value={o.id}>{o.supplier_name} · {STATUS_LABEL[o.status]} · {formatMoney(o.total_cents)}</option>
          ))}
        </select>
      </label>
      {orders !== null && orders.length === 0 && (
        <p className="proc-muted">No ordered purchase orders to match yet.</p>
      )}

      {match && (
        <>
          <table className="proc-table">
            <thead>
              <tr><th>Product</th><th className="proc-num">Ordered</th><th className="proc-num">Received</th><th className="proc-num">Line total</th><th>Match</th></tr>
            </thead>
            <tbody>
              {match.lines.map((l) => (
                <tr key={l.product_id} className={l.qty_ok ? undefined : 'proc-row-low'}>
                  <td>{l.product_name}</td>
                  <td className="proc-num">{l.ordered_qty}</td>
                  <td className="proc-num">{l.received_qty}</td>
                  <td className="proc-num">{formatMoney(l.line_total_cents)}</td>
                  <td><span className={`proc-badge proc-badge-${l.qty_ok ? 'green' : 'red'}`}>{l.qty_ok ? 'OK' : 'Mismatch'}</span></td>
                </tr>
              ))}
              <tr className="proc-total-row"><td colSpan={3} className="proc-num">PO total</td><td className="proc-num">{formatMoney(match.po_total_cents)}</td><td /></tr>
            </tbody>
          </table>

          <div className="proc-match-summary">
            <span className="proc-muted">Invoiced: <strong>{match.invoice_recorded ? formatMoney(match.invoiced_total_cents) : '—'}</strong></span>
            <span className={`proc-badge proc-badge-${match.amount_ok ? 'green' : 'red'}`}>{match.amount_ok ? 'Amount OK' : 'Amount mismatch'}</span>
            {match.expensed && <span className="proc-badge proc-badge-green">Expensed</span>}
          </div>

          {match.mismatches.length > 0 && !match.expensed && (
            <ul className="proc-mismatches">
              {match.mismatches.map((m, i) => <li key={i} className="proc-muted">{m.detail ?? m.type}</li>)}
            </ul>
          )}

          {canEdit && !match.expensed && (
            <div className="proc-match-forms">
              <form className="proc-match-form" onSubmit={recordGrn}>
                <h3 className="proc-subhead">Record goods receipt</h3>
                {match.lines.map((l) => (
                  <label key={l.product_id} className="proc-match-grn-line">
                    <span>{l.product_name}</span>
                    <input
                      type="number" min="0" value={grnQty[l.product_id] ?? ''}
                      onChange={(e) => setGrnQty((g) => ({ ...g, [l.product_id]: e.target.value }))}
                      aria-label={`Received quantity for ${l.product_name}`}
                    />
                  </label>
                ))}
                <button type="submit" className="btn btn-secondary" disabled={busy}>Record receipt</button>
              </form>
              <form className="proc-match-form" onSubmit={recordInvoice}>
                <h3 className="proc-subhead">Record invoice</h3>
                <input type="text" value={invNumber} onChange={(e) => setInvNumber(e.target.value)} placeholder="Invoice #" aria-label="Invoice number" />
                <input type="number" min="0" step="0.01" value={invAmount} onChange={(e) => setInvAmount(e.target.value)} placeholder="Amount (₹)" aria-label="Invoice amount" />
                <button type="submit" className="btn btn-secondary" disabled={busy || !invNumber.trim()}>Record invoice</button>
              </form>
            </div>
          )}

          {canEdit && !match.expensed && (
            <button
              type="button" className="btn btn-primary proc-match-confirm"
              disabled={busy || !match.matched} onClick={confirm}
            >
              {match.matched ? 'Confirm match & create expense' : 'Resolve mismatches to confirm'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
