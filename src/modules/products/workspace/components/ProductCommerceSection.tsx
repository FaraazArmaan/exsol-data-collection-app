import type { Condition, Availability } from '../../shared/types';
import { computeSalePrice } from '../../shared/discount';

type Patch = Partial<{
  discount_percent: number | null;
  gtin: string | null;
  mpn: string | null;
  condition: Condition;
  availability: Availability;
  sale_price_cents: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  weight_grams: number | null;
}>;

export function ProductCommerceSection(props: {
  price_cents: number;
  discount_percent: number | null;
  gtin: string | null;
  mpn: string | null;
  condition: Condition;
  availability: Availability;
  sale_price_cents: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  weight_grams: number | null;
  onChange: (patch: Patch) => void;
}) {
  const {
    price_cents, discount_percent,
    gtin, mpn, condition, availability,
    sale_price_cents, sale_starts_at, sale_ends_at, weight_grams,
    onChange,
  } = props;

  // datetime-local expects YYYY-MM-DDTHH:mm. ISO is YYYY-MM-DDTHH:mm:ss.sssZ.
  // Slicing keeps the date/hour/minute portion. Phase B accepts local-TZ ambiguity.
  const dtLocalValue = (iso: string | null): string => (iso ? iso.slice(0, 16) : '');
  const dtLocalToIso = (v: string): string | null => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  return (
    <details className="pm-advanced-section">
      <summary>Commerce &amp; inventory</summary>
      <div className="pm-advanced-grid">
        <div>
          <label htmlFor="pm-gtin">GTIN</label>
          <input
            id="pm-gtin"
            value={gtin ?? ''}
            maxLength={40}
            onChange={(e) => onChange({ gtin: e.target.value || null })}
          />
        </div>

        <div>
          <label htmlFor="pm-mpn">MPN</label>
          <input
            id="pm-mpn"
            value={mpn ?? ''}
            maxLength={80}
            onChange={(e) => onChange({ mpn: e.target.value || null })}
          />
        </div>

        <div>
          <label htmlFor="pm-condition">Condition</label>
          <select
            id="pm-condition"
            value={condition}
            onChange={(e) => onChange({ condition: e.target.value as Condition })}
          >
            <option value="new">new</option>
            <option value="refurbished">refurbished</option>
            <option value="used">used</option>
          </select>
        </div>

        <div>
          <label htmlFor="pm-availability">Availability</label>
          <select
            id="pm-availability"
            value={availability}
            onChange={(e) => onChange({ availability: e.target.value as Availability })}
          >
            <option value="in_stock">in_stock</option>
            <option value="out_of_stock">out_of_stock</option>
            <option value="preorder">preorder</option>
            <option value="discontinued">discontinued</option>
          </select>
        </div>

        <div className="pm-field">
          <label htmlFor="pm-discount-pct">Discount %</label>
          <input
            id="pm-discount-pct"
            type="number"
            step="0.01"
            min="0.01"
            max="99.99"
            value={discount_percent ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                onChange({ discount_percent: null });
                return;
              }
              const n = Number(raw);
              if (!Number.isFinite(n)) return;
              onChange({ discount_percent: n });
            }}
          />
          {discount_percent != null && (
            <button
              type="button"
              className="pm-link-button"
              onClick={() => onChange({ discount_percent: null })}
            >
              Clear discount
            </button>
          )}
        </div>

        <div className="pm-field">
          <label htmlFor="pm-sale-price">
            Sale price (USD){discount_percent != null && <span className="pm-muted"> (auto-calculated)</span>}
          </label>
          <input
            id="pm-sale-price"
            type="number"
            step="0.01"
            disabled={discount_percent != null}
            title={discount_percent != null ? 'Auto-calculated from MRP × (1 − discount %)' : undefined}
            value={
              discount_percent != null
                ? ((computeSalePrice(price_cents, discount_percent) ?? 0) / 100).toFixed(2)
                : (sale_price_cents == null ? '' : (sale_price_cents / 100).toFixed(2))
            }
            onChange={(e) => {
              if (discount_percent != null) return; // belt+suspenders; input is disabled anyway
              const v = e.target.value;
              if (v === '') {
                onChange({ sale_price_cents: null });
                return;
              }
              const cents = Math.round(Number(v) * 100);
              if (!Number.isFinite(cents) || cents < 0) return;
              onChange({ sale_price_cents: cents });
            }}
          />
        </div>

        <div>
          <label htmlFor="pm-sale-starts">Sale starts</label>
          <input
            id="pm-sale-starts"
            type="datetime-local"
            value={dtLocalValue(sale_starts_at)}
            onChange={(e) => onChange({ sale_starts_at: dtLocalToIso(e.target.value) })}
          />
        </div>

        <div>
          <label htmlFor="pm-sale-ends">Sale ends</label>
          <input
            id="pm-sale-ends"
            type="datetime-local"
            value={dtLocalValue(sale_ends_at)}
            onChange={(e) => onChange({ sale_ends_at: dtLocalToIso(e.target.value) })}
          />
        </div>

        <div>
          <label htmlFor="pm-weight">Weight (g)</label>
          <input
            id="pm-weight"
            type="number"
            min="0"
            value={weight_grams ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                onChange({ weight_grams: null });
                return;
              }
              const n = parseInt(raw, 10);
              onChange({ weight_grams: Number.isFinite(n) ? Math.max(0, n) : null });
            }}
          />
        </div>
      </div>
    </details>
  );
}
