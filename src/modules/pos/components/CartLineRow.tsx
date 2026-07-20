import type { CartLine } from '../store/cart';
import { formatRupees } from '../lib/money';

export function CartLineRow(props: {
  line: CartLine;
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="pos-cart-line">
      <div className="pos-cart-line__name">{props.line.productNameSnap}{props.line.variantNameSnap ? ` — ${props.line.variantNameSnap}` : ''}</div>
      <div className="pos-cart-line__qty">
        <button onClick={() => props.onQty(props.line.qty - 1)} aria-label="Decrease">−</button>
        <span>{props.line.qty}</span>
        <button onClick={() => props.onQty(props.line.qty + 1)} aria-label="Increase">+</button>
      </div>
      <div>{formatRupees(props.line.unitPriceCentsSnap * props.line.qty)}</div>
      <button onClick={props.onRemove} aria-label="Remove">×</button>
    </div>
  );
}
