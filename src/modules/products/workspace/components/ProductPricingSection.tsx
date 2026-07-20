import type { Product, ProductType } from '../../shared/types';

type Patch = Partial<{
  price_cents: number;
  sku: string | null;
  stock_qty: number | null;
  unit: string | null;
}>;

export function ProductPricingSection(props: {
  type: ProductType;
  price_cents: number;
  sku: string | null;
  stock_qty: number | null;
  unit: string | null;
  inventory: Pick<Product, 'inventory_qty_on_hand' | 'inventory_qty_reserved' | 'inventory_qty_available'> | null;
  inventoryEnabled: boolean | null;
  onChange: (patch: Patch) => void;
}) {
  const { type, price_cents, sku, stock_qty, unit, inventory, inventoryEnabled, onChange } = props;
  const priceUsd = (price_cents / 100).toFixed(2);

  return (
    <div className="pm-section">
      <h3>Pricing &amp; Inventory</h3>

      <label htmlFor="pm-price">Price (USD) *</label>
      <input
        id="pm-price"
        type="number"
        step="0.01"
        min="0"
        value={priceUsd}
        onChange={(e) => {
          const dollars = parseFloat(e.target.value || '0');
          const cents = Math.max(0, Math.round((Number.isFinite(dollars) ? dollars : 0) * 100));
          onChange({ price_cents: cents });
        }}
      />

      {type === 'physical' && (
        <div className="pm-physical-only">
          <label htmlFor="pm-sku">SKU</label>
          <input
            id="pm-sku"
            value={sku ?? ''}
            maxLength={80}
            onChange={(e) => onChange({ sku: e.target.value || null })}
          />

          {inventoryEnabled === false ? <>
            <label htmlFor="pm-stock">Stock</label>
            <input id="pm-stock" type="number" min="0" value={stock_qty ?? 0}
              onChange={(e) => onChange({ stock_qty: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })} />
          </> : <p className="pm-muted" role="status">
            {inventoryEnabled === null ? 'Checking Inventory access…' : inventory?.inventory_qty_on_hand == null
              ? 'Stock is managed in Inventory after this product is saved.'
              : `Inventory: ${inventory.inventory_qty_available ?? 0} available · ${inventory.inventory_qty_on_hand} on hand · ${inventory.inventory_qty_reserved ?? 0} reserved`}
          </p>}

          <label htmlFor="pm-unit">Unit</label>
          <select id="pm-unit" value={unit ?? 'each'} onChange={(e) => onChange({ unit: e.target.value })}>
            <option value="each">each</option>
            <option value="kg">kg</option>
            <option value="g">g</option>
            <option value="lb">lb</option>
            <option value="m">m</option>
            <option value="hr">hr</option>
          </select>
        </div>
      )}
    </div>
  );
}
