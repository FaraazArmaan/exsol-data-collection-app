import type { MenuProduct } from '../store/cart';
import { formatRupees } from '../lib/money';

export function ProductTile(props: { product: MenuProduct; inCartQty: number; onAdd: () => void }) {
  return (
    <button onClick={props.onAdd} className="pos-tile" aria-label={`Add ${props.product.name}`}>
      <div className="pos-tile__img">
        {/* thumbKey is a storage key; v2 will resolve to a URL — for now show a placeholder. */}
        {props.product.thumbKey ? null : <span className="pos-tile__placeholder" />}
      </div>
      <div className="pos-tile__name">{props.product.name}</div>
      <div className="pos-tile__price">{formatRupees(props.product.salePriceCents)}</div>
      {props.inCartQty > 0 ? (
        <span className="pos-tile__badge" aria-label={`In cart: ${props.inCartQty}`}>
          {props.inCartQty}
        </span>
      ) : null}
    </button>
  );
}
