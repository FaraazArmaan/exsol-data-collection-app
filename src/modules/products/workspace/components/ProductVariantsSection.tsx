import { useEffect, useState } from 'react';
import { variantsApi } from '../../shared/api';
import type { ProductVariant } from '../../shared/types';

function optionValues(raw: string): Record<string, string> | null {
  if (!raw.trim()) return {};
  const entries = raw.split(',').map((part) => part.trim()).filter(Boolean).map((part) => part.split('=').map((v) => v.trim()));
  if (entries.some(([key, value]) => !key || !value)) return null;
  return Object.fromEntries(entries.map(([key, value]) => [key!, value!]));
}

export function ProductVariantsSection(props: { productId: string | null; clientId?: string; canEdit: boolean }) {
  const [items, setItems] = useState<ProductVariant[]>([]);
  const [title, setTitle] = useState('');
  const [options, setOptions] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.productId) return;
    variantsApi.list(props.productId, { clientId: props.clientId })
      .then((result) => setItems(result.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load variants'));
  }, [props.productId, props.clientId]);

  if (!props.productId) {
    return <p className="pm-muted">Save this physical product before adding variants.</p>;
  }

  async function add(): Promise<void> {
    const parsedOptions = optionValues(options);
    if (!title.trim()) return setError('Variant name is required.');
    if (!parsedOptions) return setError('Options use name=value pairs, separated by commas.');
    const cents = price.trim() ? Math.round(Number(price) * 100) : null;
    if (cents != null && (!Number.isFinite(cents) || cents < 0)) return setError('Price must be zero or greater.');
    setBusy(true);
    setError(null);
    try {
      const variant = await variantsApi.create({
        product_id: props.productId!, title: title.trim(), option_values: parsedOptions,
        sku: sku.trim() || null, barcode: barcode.trim() || null, price_cents: cents,
      }, { clientId: props.clientId });
      setItems((current) => [...current, variant].sort((a, b) => a.title.localeCompare(b.title)));
      setTitle(''); setOptions(''); setSku(''); setBarcode(''); setPrice('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create variant');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="pm-advanced-section">
      <summary>Variants ({items.length})</summary>
      <p className="pm-muted">Variants inherit the product description and images. Inventory owns their quantities; POS and storefront selection are not enabled yet.</p>
      {error && <div className="pm-error" role="alert">{error}</div>}
      {items.length > 0 && (
        <ul aria-label="Product variants">
          {items.map((variant) => (
            <li key={variant.id}>
              <strong>{variant.title}</strong>{variant.sku ? ` · SKU ${variant.sku}` : ''}{variant.barcode ? ` · Barcode ${variant.barcode}` : ''}
              {variant.price_cents != null ? ` · ${(variant.price_cents / 100).toFixed(2)}` : ' · Uses product price'}
            </li>
          ))}
        </ul>
      )}
      {props.canEdit && (
        <div className="pm-advanced-grid">
          <div><label htmlFor="pm-variant-title">Variant name</label><input id="pm-variant-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Medium / Blue" /></div>
          <div><label htmlFor="pm-variant-options">Options</label><input id="pm-variant-options" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="size=M, color=Blue" /></div>
          <div><label htmlFor="pm-variant-sku">Variant SKU</label><input id="pm-variant-sku" value={sku} onChange={(e) => setSku(e.target.value)} /></div>
          <div><label htmlFor="pm-variant-barcode">Barcode</label><input id="pm-variant-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} /></div>
          <div><label htmlFor="pm-variant-price">Price override (USD)</label><input id="pm-variant-price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div><button type="button" className="pm-primary" disabled={busy || !title.trim()} onClick={() => void add()}>{busy ? 'Adding…' : 'Add variant'}</button></div>
        </div>
      )}
    </details>
  );
}
