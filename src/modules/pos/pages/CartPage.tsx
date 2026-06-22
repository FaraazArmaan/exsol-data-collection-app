import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createCartStore } from '../store/cart';
import { CartLineRow } from '../components/CartLineRow';
import { CustomerForm } from '../components/CustomerForm';
import { ChannelPicker } from '../components/ChannelPicker';
import { posApi, PosApiError } from '../api';
import { formatRupees } from '../lib/money';

export interface CartPageProps {
  bucketId: string;
  userNodeId: string;
  slug: string;
}

export default function CartPage(props: CartPageProps) {
  const useStore = useMemo(
    () => createCartStore(props.bucketId, props.userNodeId),
    [props.bucketId, props.userNodeId],
  );
  // Subscribe to the slices we display so the UI re-renders on every store change.
  const lines     = useStore((s) => s.lines);
  const customer  = useStore((s) => s.customer);
  const channel   = useStore((s) => s.channel);
  const setQty       = useStore((s) => s.setQty);
  const removeLine   = useStore((s) => s.removeLine);
  const setCustomer  = useStore((s) => s.setCustomer);
  const setChannel   = useStore((s) => s.setChannel);
  const clear        = useStore((s) => s.clear);

  const nav = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idempotencyKey = useStore((s) => s.idempotencyKey);

  // Derive locally (avoid passing a new object out of the zustand selector on every render).
  const subtotal = useMemo(
    () => lines.reduce((a, l) => a + l.qty * l.unitPriceCentsSnap, 0),
    [lines],
  );
  const validity = useMemo<{ ok: boolean; reason?: string }>(() => {
    if (lines.length === 0) return { ok: false, reason: 'empty_cart' };
    if (!customer.name.trim()) return { ok: false, reason: 'name_required' };
    if (!customer.phone.trim()) return { ok: false, reason: 'phone_required' };
    if (
      customer.email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)
    ) {
      return { ok: false, reason: 'email_invalid' };
    }
    return { ok: true };
  }, [lines, customer]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const sale = await posApi.createSale({
        channel,
        idempotencyKey,
        customer: { ...customer, email: customer.email || undefined },
        lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      });
      clear();
      nav(`/c/${props.slug}/pos/sales/${sale.id}`);
    } catch (e) {
      setError(e instanceof PosApiError ? e.code : 'network_error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pos-cart-page">
      <header>
        <Link to={`/c/${props.slug}/pos/menu`}>← Back to menu</Link>
        <h1>Checkout</h1>
      </header>
      <div className="pos-cart-page__cols">
        <section className="pos-cart-page__lines">
          {lines.length === 0 ? <p>Cart is empty.</p> : null}
          {lines.map((l) => (
            <CartLineRow
              key={l.productId}
              line={l}
              onQty={(q) => setQty(l.productId, q)}
              onRemove={() => removeLine(l.productId)}
            />
          ))}
          <div className="pos-cart-page__totals">
            <div>Subtotal {formatRupees(subtotal)}</div>
            <div className="pos-cart-page__total">Total <strong>{formatRupees(subtotal)}</strong></div>
          </div>
        </section>
        <section className="pos-cart-page__customer">
          <h2>Customer</h2>
          <CustomerForm value={customer} onChange={(p) => setCustomer(p)} />
          <h2>Channel</h2>
          <ChannelPicker value={channel} onChange={(c) => setChannel(c)} />
          {error ? <div className="err">Error: {error}</div> : null}
          <button onClick={submit} disabled={!validity.ok || submitting}>
            {submitting ? 'Submitting…' : 'Submit & take payment'}
          </button>
        </section>
      </div>
    </div>
  );
}
