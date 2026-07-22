import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { warehouseApi } from '../../shared/api';
import type { AsnDetail, AsnLine, AsnSummary, WarehouseProduct } from '../../shared/types';
import { Button } from '../../../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../../../components/ui/Feedback';

interface Props {
  perms: ReadonlySet<string>;
}

// Inbound ASN: advance shipment notices with expected-vs-received tracking. Create
// notes shipments (optionally against a PO); recording receipt captures variance.
export default function InboundTab({ perms }: Props) {
  const [asns, setAsns] = useState<AsnSummary[] | null>(null);
  const [products, setProducts] = useState<WarehouseProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const canCreate = perms.has('warehouse.products.create');
  const canReceive = perms.has('warehouse.products.edit');

  const load = useCallback(() => {
    setError(null);
    warehouseApi.asnList('all')
      .then((r) => setAsns(r.asns))
      .catch((e) => { setAsns([]); setError(e instanceof Error ? e.message : String(e)); });
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { warehouseApi.products().then((r) => setProducts(r.products)).catch(() => {}); }, []);

  const afterChange = () => {
    setCreateOpen(false);
    setOpenId(null);
    setAsns(null);
    load();
  };

  return (
    <div>
      <div className="wh-actions wh-actions-end">
        {canCreate && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={products.length === 0}
            title={products.length === 0 ? 'Add a product first' : undefined}
            onClick={() => setCreateOpen(true)}
          >
            New ASN
          </button>
        )}
      </div>

      {error && <ErrorState title="Inbound shipments could not load" action={<Button variant="secondary" onClick={load}>Try again</Button>}>{error}</ErrorState>}

      {asns === null ? (
        <LoadingState title="Loading inbound shipments" />
      ) : asns.length === 0 ? (
        <EmptyState title="No inbound shipments yet.">Create an ASN to track an incoming delivery.</EmptyState>
      ) : (
        <table className="wh-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Carrier</th>
              <th>ETA</th>
              <th>Status</th>
              <th className="wh-num">Expected</th>
              <th className="wh-num">Received</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {asns.map((a) => (
              <tr key={a.id}>
                <td>{a.reference}</td>
                <td className="wh-muted">{a.carrier ?? '—'}</td>
                <td className="wh-muted">{a.eta ?? '—'}</td>
                <td><span className={`wh-pill wh-pill-${a.status}`}>{a.status}</span></td>
                <td className="wh-num">{a.total_expected}</td>
                <td className="wh-num">{a.total_received}</td>
                <td className="wh-num">
                  <button type="button" className="wh-link" onClick={() => setOpenId(a.id)}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {createOpen && (
        <AsnCreateModal products={products} onClose={() => setCreateOpen(false)} onCreated={afterChange} />
      )}
      {openId && (
        <AsnDetailModal id={openId} canReceive={canReceive} onClose={() => setOpenId(null)} onReceived={afterChange} />
      )}
    </div>
  );
}

function AsnCreateModal({
  products, onClose, onCreated,
}: {
  products: WarehouseProduct[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [reference, setReference] = useState('');
  const [carrier, setCarrier] = useState('');
  const [eta, setEta] = useState('');
  const [lines, setLines] = useState<Array<{ product_id: string; expected_qty: string }>>([
    { product_id: '', expected_qty: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLine = (i: number, patch: Partial<{ product_id: string; expected_qty: string }>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, { product_id: '', expected_qty: '' }]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const validLines = lines
    .filter((l) => l.product_id && Number(l.expected_qty) > 0)
    .map((l) => ({ product_id: l.product_id, expected_qty: Math.trunc(Number(l.expected_qty)) }));
  const valid = reference.trim().length > 0 && validLines.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await warehouseApi.asnCreate({
        reference: reference.trim(),
        carrier: carrier.trim() || undefined,
        eta: eta || undefined,
        lines: validLines,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="wh-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wh-modal wh-modal-wide" role="dialog" aria-modal="true" aria-label="New ASN">
        <h2 className="wh-modal-title">New inbound shipment</h2>
        <form onSubmit={submit}>
          <label className="wh-field">
            <span>Reference</span>
            <input className="wh-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. SHIP-2043" autoFocus />
          </label>
          <div className="wh-field-row">
            <label className="wh-field">
              <span>Carrier</span>
              <input className="wh-input" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Optional" />
            </label>
            <label className="wh-field">
              <span>ETA</span>
              <input className="wh-input" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
            </label>
          </div>

          <div className="wh-field">
            <span>Expected lines</span>
            {lines.map((l, i) => (
              <div key={i} className="wh-line-row">
                <select className="wh-input" value={l.product_id} onChange={(e) => setLine(i, { product_id: e.target.value })}>
                  <option value="">Select product…</option>
                  {products.map((p) => (
                    <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
                  ))}
                </select>
                <input
                  className="wh-input wh-input-qty"
                  type="number"
                  min={1}
                  value={l.expected_qty}
                  onChange={(e) => setLine(i, { expected_qty: e.target.value })}
                  placeholder="Qty"
                />
                {lines.length > 1 && (
                  <button type="button" className="wh-link wh-link-danger" onClick={() => removeLine(i)} aria-label="Remove line">✕</button>
                )}
              </div>
            ))}
            <button type="button" className="wh-link" onClick={addLine}>+ Add line</button>
          </div>

          {error && <p className="wh-error" role="alert">{error}</p>}
          <div className="wh-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
              {busy ? 'Creating…' : 'Create ASN'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AsnDetailModal({
  id, canReceive, onClose, onReceived,
}: {
  id: string;
  canReceive: boolean;
  onClose: () => void;
  onReceived: () => void;
}) {
  const [detail, setDetail] = useState<AsnDetail | null>(null);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    warehouseApi.asnDetail(id)
      .then((d) => {
        setDetail(d);
        setReceived(Object.fromEntries(d.lines.map((l) => [l.id, String(l.received_qty)])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const submit = async () => {
    if (!detail || busy) return;
    setBusy(true);
    setError(null);
    try {
      await warehouseApi.asnReceive({
        asn_id: id,
        lines: detail.lines.map((l) => ({ line_id: l.id, received_qty: Math.max(0, Math.trunc(Number(received[l.id] ?? l.received_qty))) })),
      });
      onReceived();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const editable = canReceive && detail?.asn.status === 'pending';

  return (
    <div className="wh-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wh-modal wh-modal-wide" role="dialog" aria-modal="true" aria-label="ASN detail">
        {detail === null ? (
          <p className="wh-muted">Loading…</p>
        ) : (
          <>
            <h2 className="wh-modal-title">{detail.asn.reference}</h2>
            <p className="wh-muted">
              {detail.asn.carrier ?? 'No carrier'} · ETA {detail.asn.eta ?? '—'} ·{' '}
              <span className={`wh-pill wh-pill-${detail.asn.status}`}>{detail.asn.status}</span>
            </p>
            <table className="wh-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="wh-num">Expected</th>
                  <th className="wh-num">Received</th>
                  <th className="wh-num">Variance</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l: AsnLine) => {
                  const rec = editable ? Number(received[l.id] ?? l.received_qty) : l.received_qty;
                  const variance = rec - l.expected_qty;
                  return (
                    <tr key={l.id}>
                      <td>{l.product_name}</td>
                      <td className="wh-num">{l.expected_qty}</td>
                      <td className="wh-num">
                        {editable ? (
                          <input
                            className="wh-input wh-input-qty"
                            type="number"
                            min={0}
                            value={received[l.id] ?? ''}
                            onChange={(e) => setReceived((p) => ({ ...p, [l.id]: e.target.value }))}
                          />
                        ) : l.received_qty}
                      </td>
                      <td className={`wh-num ${variance < 0 ? 'wh-var-short' : variance > 0 ? 'wh-var-over' : ''}`}>
                        {variance > 0 ? `+${variance}` : variance}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {error && <p className="wh-error" role="alert">{error}</p>}
            <div className="wh-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
              {editable && (
                <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                  {busy ? 'Recording…' : 'Record receipt'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
