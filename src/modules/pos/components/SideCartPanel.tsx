import { Link } from 'react-router-dom';
import { formatRupees } from '../lib/money';
import type { CartLine } from '../store/cart';

export function SideCartPanel(props: { lines: CartLine[]; subtotal: number; checkoutHref: string }) {
  if (props.lines.length === 0) {
    return (
      <aside className="pos-side-cart pos-side-cart--empty">
        Tap items to start an order
      </aside>
    );
  }
  return (
    <aside className="pos-side-cart">
      <h3>Cart ({props.lines.length})</h3>
      <ul>
        {props.lines.map((l) => (
          <li key={l.productId}>
            {l.productNameSnap} ×{l.qty} — {formatRupees(l.unitPriceCentsSnap * l.qty)}
          </li>
        ))}
      </ul>
      <div className="pos-side-cart__total" data-testid="side-cart-total">
        Total {formatRupees(props.subtotal)}
      </div>
      <Link to={props.checkoutHref} className="pos-side-cart__checkout">Checkout →</Link>
    </aside>
  );
}
