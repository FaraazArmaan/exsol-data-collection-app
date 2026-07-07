import { useEffect, useState } from 'react';
import { posApi, PosApiError, type StorefrontTax } from '../shared/api';
import { EcommerceNav } from './EcommerceNav';

// Staff storefront tax settings (/c/:slug/pos/tax). Gated on pos.sale.refund.
// rate is entered as a percent and stored as basis points (18% → 1800).

export default function TaxPage() {
  const [tax, setTax] = useState<StorefrontTax | null>(null);
  const [ratePct, setRatePct] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    posApi.getTax()
      .then((r) => { setTax(r.tax); setRatePct(String(r.tax.rateBps / 100)); })
      .catch((e) => setError(e instanceof PosApiError ? e.code : 'network_error'));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!tax) return;
    setState('saving');
    setError(null);
    try {
      await posApi.putTax({ ...tax, rateBps: Math.round(Number(ratePct) * 100) });
      setState('saved');
      setTimeout(() => setState('idle'), 1500);
    } catch (e) {
      setError(e instanceof PosApiError ? e.code : 'network_error');
      setState('idle');
    }
  }

  if (!tax) return <p className="pos-loading">Loading…</p>;

  return (
    <div className="pos-tax">
      <EcommerceNav active="tax" />
      <header><h1>Tax / VAT</h1><p className="muted">Applied to storefront orders after any discount.</p></header>

      <form className="pos-tax__form" onSubmit={save}>
        <label className="pos-tax__toggle">
          <input type="checkbox" checked={tax.enabled} onChange={(e) => setTax({ ...tax, enabled: e.target.checked })} />
          Collect tax on storefront orders
        </label>

        <div className="pos-tax__grid">
          <label>Rate (%)
            <input value={ratePct} onChange={(e) => setRatePct(e.target.value)} inputMode="decimal" disabled={!tax.enabled} />
          </label>
          <label>Label
            <input value={tax.label} onChange={(e) => setTax({ ...tax, label: e.target.value })} disabled={!tax.enabled} placeholder="GST" />
          </label>
        </div>

        <label className="pos-tax__toggle">
          <input type="checkbox" checked={tax.inclusive} onChange={(e) => setTax({ ...tax, inclusive: e.target.checked })} disabled={!tax.enabled} />
          Prices already include tax (inclusive)
        </label>

        {error && <div className="err">Error: {error}</div>}
        <button className="pos-side-cart__checkout" type="submit" disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Save'}
        </button>
      </form>
    </div>
  );
}
