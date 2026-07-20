import type { MenuProduct, MenuVariant } from '../store/cart';
import { formatRupees } from '../lib/money';

// onAdd optional: when omitted (Catalog Website reuse), the tile renders as a
// non-interactive card with no add-to-cart affordance.
export function ProductTile(props: { product: MenuProduct; inCartQty: number; onAdd?: (variant?: MenuVariant) => void }) {
  const p = props.product;
  // Bundle sold-out is only meaningful on storefront/catalog payloads that carry
  // the flag; undefined (staff menu) → treated as available.
  const soldOut = p.isBundle === true && p.bundleInStock === false;
  const inner = (
    <>
      <div className="pos-tile__img">
        {/* thumbKey is a storage key; v2 will resolve to a URL — for now show a placeholder. */}
        {p.thumbKey ? null : <span className="pos-tile__placeholder" />}
        {p.isBundle && <span className="pos-tile__bundle" aria-label="Bundle">Bundle</span>}
        {soldOut && <span className="pos-tile__soldout">Sold out</span>}
      </div>
      <div className="pos-tile__name">{p.name}</div>
      <div className="pos-tile__price">{formatRupees(p.salePriceCents)}</div>
      {p.isBundle && p.bundleComponents && p.bundleComponents.length > 0 && (
        <div className="pos-tile__components">
          {p.bundleComponents.map((c) => `${c.qty}× ${c.name}`).join(' + ')}
        </div>
      )}
      {props.inCartQty > 0 ? (
        <span className="pos-tile__badge" aria-label={`In cart: ${props.inCartQty}`}>
          {props.inCartQty}
        </span>
      ) : null}
    </>
  );

  if (!props.onAdd) {
    return <div className="pos-tile pos-tile--static">{inner}</div>;
  }
  if (!soldOut && p.variants && p.variants.length > 0) {
    return <div className="pos-tile">
      {inner}
      <div className="pos-tile__variants" role="group" aria-label={`Choose ${p.name} option`}>
        <span className="pos-tile__variant-label">Choose an option</span>
        {p.variants.map((variant) => (
          <button type="button" className="pos-tile__variant" key={variant.id}
            onClick={() => props.onAdd!(variant)} aria-label={`Add ${p.name}, ${variant.title}`}>
            <span>{variant.title}</span><span>{formatRupees(variant.salePriceCents)}</span>
          </button>
        ))}
      </div>
    </div>;
  }
  return (
    <button
      onClick={() => props.onAdd!()}
      className="pos-tile"
      aria-label={`Add ${p.name}`}
      disabled={soldOut}
    >
      {inner}
    </button>
  );
}
