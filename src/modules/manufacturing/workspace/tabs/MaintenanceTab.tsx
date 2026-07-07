import { useCallback, useEffect, useState } from 'react';
import { manufacturingApi, ManufacturingApiError } from '../../shared/api';
import type { MaintKind, MaintLog, ProductPick, ScrapLog } from '../../shared/types';

interface Props {
  perms: ReadonlySet<string>;
}

// Maintenance / Downtime / Scrap. Maintenance+downtime are shop-floor logs
// (business bucket); scrap decrements product stock through the movements ledger.
export default function MaintenanceTab({ perms }: Props) {
  const [logs, setLogs] = useState<MaintLog[] | null>(null);
  const [scrapLogs, setScrapLogs] = useState<ScrapLog[] | null>(null);
  const [products, setProducts] = useState<ProductPick[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<MaintKind>('maintenance');
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('0');
  const [resource, setResource] = useState('');

  const [scrapProduct, setScrapProduct] = useState('');
  const [scrapQty, setScrapQty] = useState('1');
  const [scrapReason, setScrapReason] = useState('');

  const canLog = perms.has('manufacturing.business.create');
  const canScrap = perms.has('manufacturing.products.edit');
  const canViewScrap = perms.has('manufacturing.products.view');

  const load = useCallback(() => {
    setError(null);
    manufacturingApi.maintenance().then((r) => setLogs(r.logs)).catch((e) => { setLogs([]); setError(e instanceof ManufacturingApiError ? e.code : String(e)); });
    if (canViewScrap) manufacturingApi.scrapList().then((r) => setScrapLogs(r.logs)).catch(() => setScrapLogs([]));
    else setScrapLogs([]);
  }, [canViewScrap]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (canScrap) manufacturingApi.products().then((r) => setProducts(r.items)).catch(() => {}); }, [canScrap]);

  const addLog = async () => {
    if (!reason.trim()) { setError('A reason is required.'); return; }
    setError(null);
    try {
      await manufacturingApi.addMaintenance({ kind, reason: reason.trim(), minutes: Math.max(0, Number(minutes) || 0), resource_label: resource.trim() || undefined });
      setReason(''); setMinutes('0'); setResource('');
      load();
    } catch (e) { setError(e instanceof ManufacturingApiError ? e.code : String(e)); }
  };

  const doScrap = async () => {
    if (!scrapProduct) { setError('Pick a product to scrap.'); return; }
    setError(null);
    try {
      await manufacturingApi.scrap({ product_id: scrapProduct, qty: Math.max(1, Number(scrapQty) || 1), reason: scrapReason.trim() || undefined });
      setScrapQty('1'); setScrapReason('');
      load();
    } catch (e) {
      setError(e instanceof ManufacturingApiError && e.code === 'insufficient_stock' ? 'Not enough stock on hand to scrap that quantity.' : (e instanceof ManufacturingApiError ? e.code : String(e)));
    }
  };

  return (
    <div>
      {error && <div className="mfg-shortfall" role="alert">{error} <button type="button" className="mfg-btn" onClick={() => setError(null)}>dismiss</button></div>}

      <h4>Maintenance &amp; downtime</h4>
      {canLog && (
        <div className="mfg-lot-form">
          <select value={kind} onChange={(e) => setKind(e.target.value as MaintKind)} aria-label="Kind">
            <option value="maintenance">Maintenance</option>
            <option value="downtime">Downtime</option>
          </select>
          <input placeholder="Resource (optional)" value={resource} onChange={(e) => setResource(e.target.value)} />
          <input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <input type="number" min={0} style={{ width: 80 }} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes" />
          <button className="mfg-btn primary" onClick={() => void addLog()}>Log</button>
        </div>
      )}
      {logs === null ? <p className="mfg-empty">Loading…</p>
        : logs.length === 0 ? <div className="mfg-empty">No maintenance or downtime logged.</div>
        : (
          <table className="mfg-table">
            <thead><tr><th>Date</th><th>Kind</th><th>Resource</th><th>Reason</th><th>Mins</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="mfg-muted">{l.occurred_on}</td>
                  <td><span className={`mfg-qc mfg-kind-${l.kind}`}>{l.kind}</span></td>
                  <td>{l.resource_label ?? '—'}</td>
                  <td>{l.reason}</td>
                  <td>{l.minutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <h4 style={{ marginTop: 24 }}>Scrap</h4>
      {canScrap && (
        <div className="mfg-lot-form">
          <select value={scrapProduct} onChange={(e) => setScrapProduct(e.target.value)} aria-label="Product">
            <option value="">— product —</option>
            {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
          </select>
          <input type="number" min={1} style={{ width: 70 }} value={scrapQty} onChange={(e) => setScrapQty(e.target.value)} aria-label="Qty" />
          <input placeholder="Reason (optional)" value={scrapReason} onChange={(e) => setScrapReason(e.target.value)} />
          <button className="mfg-btn primary" onClick={() => void doScrap()} disabled={!scrapProduct}>Scrap</button>
        </div>
      )}
      {scrapLogs === null ? <p className="mfg-empty">Loading…</p>
        : scrapLogs.length === 0 ? <div className="mfg-empty">No scrap recorded.</div>
        : (
          <table className="mfg-table">
            <thead><tr><th>Date</th><th>Product</th><th>Qty</th><th>Reason</th></tr></thead>
            <tbody>
              {scrapLogs.map((l) => (
                <tr key={l.id}>
                  <td className="mfg-muted">{l.occurred_on}</td>
                  <td>{l.product_name}</td>
                  <td>{l.qty}</td>
                  <td className="mfg-muted">{l.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
