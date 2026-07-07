// @vitest-environment jsdom — skipped; this component is FE-only, verify in browser.
// RefundsShipmentsTab — Return/Refund workflow + Shipment Tracking UI (Task 2).
// Renders inside the Orders dashboard as a tabbed panel (560px responsive).
import { useEffect, useState } from 'react';
import { ordersApi, OrdersApiError } from '../../shared/api';
import type { RefundRow, RefundState, ShipmentRow } from '../../shared/types';

interface Props {
  perms: ReadonlySet<string>;
}

// ── helpers ────────────────────────────────────────────────────────────────────

const REFUND_STATE_LABEL: Record<RefundState, string> = {
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  completed: 'Completed',
};

const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  shipped: 'Shipped',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  returned: 'Returned',
};

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function humanError(e: unknown): string {
  if (e instanceof OrdersApiError) {
    if (e.status === 412) return 'Orders module not enabled.';
    if (e.status === 403) return 'Permission denied.';
    if (e.status === 400 && e.code === 'amount_invalid') return 'Amount must be between 1 and the sale total.';
    if (e.status === 404) return 'Sale not found or belongs to another client.';
    return `Error: ${e.code}`;
  }
  return 'Network error — please try again.';
}

// ── Refunds sub-panel ─────────────────────────────────────────────────────────

function RefundsPanel({ canCreate, canEdit }: { canCreate: boolean; canEdit: boolean }) {
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [advanceMsg, setAdvanceMsg] = useState<string | null>(null);

  // Create-refund form state
  const [saleId, setSaleId] = useState('');
  const [amountCents, setAmountCents] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function loadRefunds() {
    setLoading(true);
    ordersApi
      .listRefunds()
      .then((data) => {
        setRefunds(data);
        setError(null);
      })
      .catch((e) => setError(humanError(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadRefunds(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const cents = parseInt(amountCents, 10);
    if (!saleId.trim() || isNaN(cents) || cents <= 0) {
      setFormError('Sale ID and a positive amount (in cents) are required.');
      return;
    }
    setSubmitting(true);
    try {
      await ordersApi.createRefund({ sale_id: saleId.trim(), amount_cents: cents, reason: reason || undefined });
      setSaleId('');
      setAmountCents('');
      setReason('');
      loadRefunds();
    } catch (e) {
      setFormError(humanError(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdvance(id: string, to: string) {
    setAdvanceMsg(null);
    try {
      const res = await ordersApi.advanceRefund(id, to);
      let msg = `Refund ${to}.`;
      if (to === 'completed' && res.sale_refunded) msg += ' Sale marked refunded.';
      if (to === 'completed' && !res.sale_refunded) msg += ' Sale status unchanged (not in paid/fulfilled).';
      setAdvanceMsg(msg);
      loadRefunds();
    } catch (e) {
      setAdvanceMsg(humanError(e));
    }
  }

  const nextActions: Record<string, string[]> = {
    requested: ['approved', 'rejected'],
    approved: ['completed'],
  };

  return (
    <section className="ord-section">
      <h2 className="ord-section-title">Refunds</h2>

      {canCreate && (
        <form className="ord-form" onSubmit={handleCreate}>
          <div className="ord-form-row">
            <input
              className="ord-input"
              placeholder="Sale UUID"
              value={saleId}
              onChange={(e) => setSaleId(e.target.value)}
              required
            />
            <input
              className="ord-input"
              type="number"
              placeholder="Amount (cents)"
              value={amountCents}
              onChange={(e) => setAmountCents(e.target.value)}
              min={1}
              required
            />
            <input
              className="ord-input"
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button className="ord-btn ord-btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Requesting…' : 'Request Refund'}
            </button>
          </div>
          {formError && <p className="ord-form-error">{formError}</p>}
        </form>
      )}

      {advanceMsg && <p className="ord-advance-msg">{advanceMsg}</p>}

      {loading ? (
        <p className="ord-muted">Loading refunds…</p>
      ) : error ? (
        <div className="ord-error">{error}</div>
      ) : refunds.length === 0 ? (
        <p className="ord-empty">No refunds yet.</p>
      ) : (
        <table className="ord-table">
          <thead>
            <tr>
              <th>Order #</th>
              <th>Customer</th>
              <th className="ord-num">Amount (¢)</th>
              <th>Reason</th>
              <th>State</th>
              {canEdit && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {refunds.map((r) => (
              <tr key={r.id}>
                <td>{r.order_no}</td>
                <td>{r.customer_name}</td>
                <td className="ord-num">{formatCents(r.amount_cents)}</td>
                <td>{r.reason ?? '—'}</td>
                <td>
                  <span className={`ord-badge ord-badge-${r.state}`}>
                    {REFUND_STATE_LABEL[r.state] ?? r.state}
                  </span>
                </td>
                {canEdit && (
                  <td className="ord-actions">
                    {(nextActions[r.state] ?? []).map((to) => (
                      <button
                        key={to}
                        className="ord-btn ord-btn-sm"
                        onClick={() => handleAdvance(r.id, to)}
                      >
                        → {to}
                      </button>
                    ))}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── Shipments sub-panel ───────────────────────────────────────────────────────

function ShipmentsPanel({ canCreate, canEdit }: { canCreate: boolean; canEdit: boolean }) {
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [saleId, setSaleId] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingRef, setTrackingRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function loadShipments() {
    setLoading(true);
    ordersApi
      .listShipments()
      .then((data) => {
        setShipments(data);
        setError(null);
      })
      .catch((e) => setError(humanError(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadShipments(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!saleId.trim()) {
      setFormError('Sale ID is required.');
      return;
    }
    setSubmitting(true);
    try {
      await ordersApi.createShipment({
        sale_id: saleId.trim(),
        carrier: carrier || undefined,
        tracking_ref: trackingRef || undefined,
      });
      setSaleId('');
      setCarrier('');
      setTrackingRef('');
      loadShipments();
    } catch (e) {
      setFormError(humanError(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdvanceStatus(id: string, status: string) {
    try {
      await ordersApi.updateShipment(id, { status });
      loadShipments();
    } catch (e) {
      setError(humanError(e));
    }
  }

  // Next logical status transitions
  const nextStatus: Record<string, string[]> = {
    pending: ['shipped'],
    shipped: ['in_transit', 'delivered'],
    in_transit: ['delivered'],
    delivered: ['returned'],
  };

  return (
    <section className="ord-section">
      <h2 className="ord-section-title">Shipments</h2>

      {canCreate && (
        <form className="ord-form" onSubmit={handleCreate}>
          <div className="ord-form-row">
            <input
              className="ord-input"
              placeholder="Sale UUID"
              value={saleId}
              onChange={(e) => setSaleId(e.target.value)}
              required
            />
            <input
              className="ord-input"
              placeholder="Carrier (optional)"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
            />
            <input
              className="ord-input"
              placeholder="Tracking ref (optional)"
              value={trackingRef}
              onChange={(e) => setTrackingRef(e.target.value)}
            />
            <button className="ord-btn ord-btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create Shipment'}
            </button>
          </div>
          {formError && <p className="ord-form-error">{formError}</p>}
        </form>
      )}

      {loading ? (
        <p className="ord-muted">Loading shipments…</p>
      ) : error ? (
        <div className="ord-error">{error}</div>
      ) : shipments.length === 0 ? (
        <p className="ord-empty">No shipments yet.</p>
      ) : (
        <table className="ord-table">
          <thead>
            <tr>
              <th>Order #</th>
              <th>Customer</th>
              <th>Carrier</th>
              <th>Tracking</th>
              <th>Status</th>
              <th>Shipped</th>
              <th>Delivered</th>
              <th>Print</th>
              {canEdit && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => (
              <tr key={s.id}>
                <td>{s.order_no}</td>
                <td>{s.customer_name}</td>
                <td>{s.carrier ?? '—'}</td>
                <td>{s.tracking_ref ?? '—'}</td>
                <td>
                  <span className={`ord-badge ord-badge-${s.status}`}>
                    {SHIPMENT_STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </td>
                <td>{s.shipped_at ? new Date(s.shipped_at).toLocaleDateString() : '—'}</td>
                <td>{s.delivered_at ? new Date(s.delivered_at).toLocaleDateString() : '—'}</td>
                <td className="ord-actions">
                  <a
                    className="ord-btn ord-btn-sm"
                    href={ordersApi.pickListUrl(s.sale_id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Pick list
                  </a>
                  <a
                    className="ord-btn ord-btn-sm"
                    href={ordersApi.packingSlipUrl(s.sale_id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Packing slip
                  </a>
                </td>
                {canEdit && (
                  <td className="ord-actions">
                    {(nextStatus[s.status] ?? []).map((st) => (
                      <button
                        key={st}
                        className="ord-btn ord-btn-sm"
                        onClick={() => handleAdvanceStatus(s.id, st)}
                      >
                        → {st}
                      </button>
                    ))}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function RefundsShipmentsTab({ perms }: Props) {
  const canView   = perms.has('orders.business.view')   || perms.has('orders.business.create');
  const canCreate = perms.has('orders.business.create');
  const canEdit   = perms.has('orders.business.edit');

  if (!canView) {
    return (
      <div className="ord-shell">
        <p className="ord-muted">You don&rsquo;t have permission to view this section.</p>
      </div>
    );
  }

  return (
    <div className="ord-shell">
      <RefundsPanel canCreate={canCreate} canEdit={canEdit} />
      <ShipmentsPanel canCreate={canCreate} canEdit={canEdit} />
    </div>
  );
}
