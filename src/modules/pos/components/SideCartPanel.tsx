import { Link } from 'react-router-dom';
import { formatRupees } from '../lib/money';
import type { CartLine } from '../store/cart';
import { CartLineRow } from './CartLineRow';

export function SideCartPanel(props: {
  lines: CartLine[];
  subtotal: number;
  checkoutHref: string;
  onQty: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
}) {
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
      <div className="pos-side-cart__lines">
        {props.lines.map((l) => (
          <CartLineRow
            key={l.productId}
            line={l}
            onQty={(q) => props.onQty(l.productId, q)}
            onRemove={() => props.onRemove(l.productId)}
          />
        ))}
      </div>
      <div className="pos-side-cart__total" data-testid="side-cart-total">
        Total {formatRupees(props.subtotal)}
      </div>
      <Link to={props.checkoutHref} className="pos-side-cart__checkout">Checkout →</Link>
    </aside>
  );
}
