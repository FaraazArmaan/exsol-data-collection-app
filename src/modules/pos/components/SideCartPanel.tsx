import { Link } from 'react-router-dom';
import { formatRupees } from '../lib/money';
import type { CartLine } from '../store/cart';
import { CartLineRow } from './CartLineRow';

// onQty/onRemove are optional: when supplied (staff menu, storefront menu) each
// line gets the CartLineRow stepper; when omitted the panel degrades to a
// read-only summary. Keeping them optional means callers that don't wire the
// controls (e.g. a branch whose MenuPage predates this change) still typecheck.
export function SideCartPanel(props: {
  lines: CartLine[];
  subtotal: number;
  checkoutHref: string;
  onQty?: (productId: string, qty: number) => void;
  onRemove?: (productId: string) => void;
}) {
  const { onQty, onRemove } = props;
  const interactive = !!onQty && !!onRemove;

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
      {interactive ? (
        <div className="pos-side-cart__lines">
          {props.lines.map((l) => (
            <CartLineRow
              key={l.productId}
              line={l}
              onQty={(q) => onQty!(l.productId, q)}
              onRemove={() => onRemove!(l.productId)}
            />
          ))}
        </div>
      ) : (
        <ul>
          {props.lines.map((l) => (
            <li key={l.productId}>
              {l.productNameSnap} ×{l.qty} — {formatRupees(l.unitPriceCentsSnap * l.qty)}
            </li>
          ))}
        </ul>
      )}
      <div className="pos-side-cart__total" data-testid="side-cart-total">
        Total {formatRupees(props.subtotal)}
      </div>
      <Link to={props.checkoutHref} className="pos-side-cart__checkout">Checkout →</Link>
    </aside>
  );
}
