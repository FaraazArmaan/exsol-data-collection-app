import { useEffect, useState } from 'react';
import { posApi, PosApiError, type Bundle, type MenuProductDto } from '../shared/api';
import { formatRupees } from '../lib/money';

// Staff bundle manager (/c/:slug/pos/bundles). Compose existing products into a
// priced bundle; stock is derived from components. Gated on pos.sale.refund.

interface Line { productId: string; qty: number }

export default function BundlesPage() {
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  const [products, setProducts] = useState<MenuProductDto[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [lines, setLines] = useState<Line[]>([{ productId: '', qty: 1 }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [b, m] = await Promise.all([posApi.listBundles(), posApi.getMenu()]);
      setBundles(b.bundles);
      // Only non-bundle products are valid components; the menu endpoint doesn't
      // flag bundles, so we simply offer everything and let the server reject nesting.
      setProducts(m.products);
    } catch (e) {
      setError(e instanceof PosApiError ? e.code : 'network_error');
    }
  }
  useEffect(() => { void load(); }, []);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const components = lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, qty: l.qty }));
      if (components.length === 0) { setError('add_component'); setSaving(false); return; }
      await posApi.createBundle({
        name: name.trim(),
        priceCents: Math.round(Number(price) * 100),
        components,
      });
      setName(''); setPrice(''); setLines([{ productId: '', qty: 1 }]);
      await load();
    } catch (e) {
      setError(e instanceof PosApiError ? e.code : 'network_error');
    } finally {
      setSaving(false);
    }
  }

  async function remove(b: Bundle) {
    try { await posApi.deleteBundle(b.id); await load(); }
    catch (e) { setError(e instanceof PosApiError ? e.code : 'network_error'); }
  }

  return (
    <div className="pos-bundles">
      <header><h1>Bundles</h1><p className="muted">Sell products together at a set price.</p></header>

      <form className="pos-bundles__form" onSubmit={create}>
        <div className="pos-bundles__row2">
          <label>Bundle name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cut + Beard combo" required />
          </label>
          <label>Price (₹)
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required />
          </label>
        </div>

        <div className="pos-bundles__components">
          <span className="pos-bundles__label">Components</span>
          {lines.map((l, i) => (
            <div key={i} className="pos-bundles__line">
              <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                <option value="">Select product…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatRupees(p.salePriceCents)}</option>)}
              </select>
              <input type="number" min={1} max={99} value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} className="pos-bundles__qty" />
              {lines.length > 1 && (
                <button type="button" className="pos-bundles__x" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>×</button>
              )}
            </div>
          ))}
          <button type="button" className="pos-bundles__add" onClick={() => setLines((ls) => [...ls, { productId: '', qty: 1 }])}>+ Add component</button>
        </div>

        {error && <div className="err">Error: {error}</div>}
        <button className="pos-side-cart__checkout" type="submit" disabled={saving || name.trim() === ''}>
          {saving ? 'Creating…' : 'Create bundle'}
        </button>
      </form>

      <div className="pos-bundles__list">
        {bundles === null ? (
          <p className="pos-loading">Loading…</p>
        ) : bundles.length === 0 ? (
          <p className="muted">No bundles yet.</p>
        ) : (
          bundles.map((b) => (
            <div key={b.id} className="pos-bundles__item">
              <div className="pos-bundles__head">
                <strong>{b.name}</strong>
                <span className="pos-bundles__price">{formatRupees(b.priceCents)}</span>
                <span className={`pos-bundles__stock${b.inStock ? '' : ' is-out'}`}>{b.inStock ? 'In stock' : 'Sold out'}</span>
              </div>
              <div className="pos-bundles__contents">{b.components.map((c) => `${c.qty}× ${c.name}`).join(' + ') || '—'}</div>
              <button type="button" className="pos-bundles__del" onClick={() => remove(b)}>Delete</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
