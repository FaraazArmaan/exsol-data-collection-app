import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createGuestCartStore } from '../store/cart';
import { getOrCreateStorefrontSession } from '../lib/session';
import { CartLineRow } from '../components/CartLineRow';
import { formatRupees } from '../lib/money';
import { StorefrontShell } from './StorefrontShell';

// Guest cart review. Reuses CartLineRow (−/＋/× stepper); "Continue" advances
// to the details page. No customer form here — that lives on details with the
// honeypot. See spec §6.6.
export default function StorefrontCartPage() {
  const { slug } = useParams<{ slug: string }>();
  const sessionId = getOrCreateStorefrontSession();
  const useStore = useMemo(() => createGuestCartStore(slug!, sessionId), [slug, sessionId]);
  const lines = useStore((s) => s.lines);
  const subtotal = useStore((s) => s.subtotalCents());
  const setQty = useStore((s) => s.setQty);
  const removeLine = useStore((s) => s.removeLine);
  const nav = useNavigate();

  return (
    <StorefrontShell>
      <div className="pos-cart-page">
        <header>
          <Link to={`/menu/${slug}`}>← Back to menu</Link>
          <h1>Your order</h1>
        </header>
        {lines.length === 0 ? (
          <p className="muted">Your cart is empty.</p>
        ) : (
          <>
            <div className="pos-cart-page__lines">
              {lines.map((l) => (
                <CartLineRow
                  key={l.productId}
                  line={l}
                  onQty={(q) => setQty(l.productId, q)}
                  onRemove={() => removeLine(l.productId)}
                />
              ))}
            </div>
            <div className="pos-cart-page__totals">
              <div className="pos-cart-page__total">Total <strong>{formatRupees(subtotal)}</strong></div>
            </div>
            <button
              className="pos-side-cart__checkout"
              onClick={() => nav(`/menu/${slug}/details`)}
            >
              Continue
            </button>
          </>
        )}
      </div>
    </StorefrontShell>
  );
}
