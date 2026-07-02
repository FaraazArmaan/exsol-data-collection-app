import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createGuestCartStore } from '../store/cart';
import { getOrCreateStorefrontSession } from '../lib/session';
import { publicApi, PosApiError } from '../api';

// Customer details + place order. Owns the honeypot (a hidden field bots fill
// and humans never see) so it lives with the form, not in the shared
// CustomerForm. Submits the guest cart; the per-tab session id doubles as the
// idempotency key. See spec §6.7. Branded chrome is supplied by StorefrontLayout.
export default function StorefrontDetailsPage() {
  const { slug } = useParams<{ slug: string }>();
  const sessionId = getOrCreateStorefrontSession();
  const useStore = useMemo(() => createGuestCartStore(slug!, sessionId), [slug, sessionId]);
  const lines = useStore((s) => s.lines);
  const customer = useStore((s) => s.customer);
  const channel = useStore((s) => s.channel);
  const setCustomer = useStore((s) => s.setCustomer);
  const setChannel = useStore((s) => s.setChannel);
  const clear = useStore((s) => s.clear);
  const nav = useNavigate();

  const [honeypot, setHoneypot] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The store can technically hold 'instore'; the storefront only allows public
  // channels, so coerce here and in the picker.
  const publicChannel: 'online' | 'pickup' = channel === 'online' ? 'online' : 'pickup';

  const canSubmit =
    lines.length > 0 && customer.name.trim() !== '' && customer.phone.trim() !== '' && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const sale = await publicApi.createSale({
        slug: slug!,
        channel: publicChannel,
        idempotencyKey: sessionId,
        honeypot,
        customer: { ...customer, email: customer.email || undefined },
        lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      });
      clear();
      nav(`/menu/${slug}/order/${sale.id}`);
    } catch (err) {
      setError(err instanceof PosApiError ? err.code : 'network_error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="pos-cart-page__customer" onSubmit={submit}>
        <header>
          <Link to={`/menu/${slug}/cart`}>← Back to cart</Link>
          <h1>Your details</h1>
        </header>

        <label>
          Name *
          <input value={customer.name} onChange={(e) => setCustomer({ name: e.target.value })} />
        </label>
        <label>
          Phone *
          <input value={customer.phone} onChange={(e) => setCustomer({ phone: e.target.value })} />
        </label>
        <label>
          Email
          <input value={customer.email} onChange={(e) => setCustomer({ email: e.target.value })} />
        </label>

        <div className="pos-channel" role="radiogroup" aria-label="Fulfilment">
          <button type="button" role="radio" aria-checked={publicChannel === 'pickup'}
            className={publicChannel === 'pickup' ? 'is-active' : ''} onClick={() => setChannel('pickup')}>Pickup</button>
          <button type="button" role="radio" aria-checked={publicChannel === 'online'}
            className={publicChannel === 'online' ? 'is-active' : ''} onClick={() => setChannel('online')}>Delivery</button>
        </div>

        {/* Honeypot — hidden from humans; bots that fill every field trip it. */}
        <input
          name="company"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ position: 'absolute', left: '-10000px', opacity: 0, pointerEvents: 'none', height: 0 }}
        />

        {error && <div className="err">Error: {error}</div>}
        <button className="pos-side-cart__checkout" type="submit" disabled={!canSubmit}>
          {submitting ? 'Placing order…' : 'Place order'}
        </button>
    </form>
  );
}
