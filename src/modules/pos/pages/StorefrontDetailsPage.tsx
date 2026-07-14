import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { createGuestCartStore } from '../store/cart';
import { getOrCreateStorefrontSession } from '../lib/session';
import { publicApi, PosApiError, type CouponPreview, type StorefrontConfig } from '../shared/api';
import { formatMoney } from '../../../lib/currency';
import { storefrontPath } from '../lib/storefront-path';

// Human-readable copy for the coupon rejection codes the API returns.
const COUPON_REASONS: Record<string, string> = {
  coupon_not_found: "That code isn't valid.",
  coupon_inactive: 'This coupon is no longer active.',
  coupon_not_started: "This coupon isn't active yet.",
  coupon_expired: 'This coupon has expired.',
  coupon_exhausted: 'This coupon has been fully redeemed.',
  coupon_min_order: "Your order doesn't meet this coupon's minimum.",
  coupon_no_effect: "This coupon doesn't apply to your order.",
  network_error: "Couldn't check that code — try again.",
};

// Customer details + place order. Owns the honeypot (a hidden field bots fill
// and humans never see) so it lives with the form, not in the shared
// CustomerForm. Submits the guest cart; the per-tab session id doubles as the
// idempotency key. See spec §6.7. Branded chrome is supplied by StorefrontLayout.
export default function StorefrontDetailsPage() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const sessionId = getOrCreateStorefrontSession();
  const useStore = useMemo(() => createGuestCartStore(slug!, sessionId), [slug, sessionId]);
  const lines = useStore((s) => s.lines);
  const subtotal = useStore((s) => s.subtotalCents());
  const customer = useStore((s) => s.customer);
  const channel = useStore((s) => s.channel);
  const setCustomer = useStore((s) => s.setCustomer);
  const setChannel = useStore((s) => s.setChannel);
  const clear = useStore((s) => s.clear);
  const nav = useNavigate();

  const [honeypot, setHoneypot] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState<CouponPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [config, setConfig] = useState<StorefrontConfig | null>(null);

  // Tax + currency config for the live preview. Server recomputes at checkout.
  useEffect(() => {
    publicApi.getConfig(slug!).then(setConfig).catch(() => setConfig(null));
  }, [slug]);

  const currency = config?.currency ?? 'INR';
  const discount = coupon?.valid ? coupon.discountCents : 0;
  const taxable = subtotal - discount;
  // Mirrors _shared/tax.computeTax — server is authoritative; this is preview only.
  const tax = (() => {
    const t = config?.tax;
    if (!t || !t.enabled || t.rateBps <= 0 || taxable <= 0) return 0;
    return t.inclusive
      ? taxable - Math.round((taxable * 10000) / (10000 + t.rateBps))
      : Math.round((taxable * t.rateBps) / 10000);
  })();
  const taxLabel = config?.tax?.label ?? 'Tax';
  const taxInclusive = config?.tax?.inclusive ?? false;
  const total = taxable + (taxInclusive ? 0 : tax);

  async function applyCoupon() {
    const code = couponCode.trim();
    if (!code) return;
    setChecking(true);
    try {
      // Preview only — the server re-checks the code against live prices and the
      // redemption count at checkout, so this can never be trusted into a charge.
      setCoupon(await publicApi.validateCoupon(slug!, code, subtotal));
    } catch {
      setCoupon({ valid: false, reason: 'network_error' });
    } finally {
      setChecking(false);
    }
  }

  function clearCoupon() {
    setCoupon(null);
    setCouponCode('');
  }

  // Persist the cart for abandoned-cart email once the guest supplies an email.
  // Best-effort and fire-and-forget — this must never block or fail checkout.
  function persistCart() {
    const email = customer.email.trim();
    if (!email || lines.length === 0) return;
    publicApi
      .saveCart({
        slug: slug!,
        sessionKey: sessionId,
        channel: publicChannel,
        customer: { name: customer.name || undefined, email },
        lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      })
      .catch(() => { /* ignore — persistence is opportunistic */ });
  }

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
        couponCode: coupon?.valid ? coupon.code : undefined,
      });
      clear();
      nav(storefrontPath(location.pathname, slug!, `order/${sale.id}`));
    } catch (err) {
      setError(err instanceof PosApiError ? err.code : 'network_error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="pos-cart-page__customer" onSubmit={submit}>
        <header>
          <Link to={storefrontPath(location.pathname, slug!, 'cart')}>← Back to cart</Link>
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
          <input value={customer.email} onChange={(e) => setCustomer({ email: e.target.value })} onBlur={persistCart} type="email" />
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

        {/* Coupon — preview only; the server re-validates at checkout. */}
        <div className="pos-coupon">
          {coupon?.valid ? (
            <div className="pos-coupon__applied">
              <span>Coupon <strong>{coupon.code}</strong> applied</span>
              <button type="button" className="pos-coupon__remove" onClick={clearCoupon}>Remove</button>
            </div>
          ) : (
            <div className="pos-coupon__row">
              <input
                className="pos-coupon__input"
                placeholder="Coupon code"
                value={couponCode}
                onChange={(e) => { setCouponCode(e.target.value); if (coupon) setCoupon(null); }}
                aria-label="Coupon code"
              />
              <button
                type="button"
                className="pos-coupon__apply"
                onClick={applyCoupon}
                disabled={checking || couponCode.trim() === ''}
              >
                {checking ? 'Checking…' : 'Apply'}
              </button>
            </div>
          )}
          {coupon && !coupon.valid && (
            <p className="pos-coupon__err">{COUPON_REASONS[coupon.reason] ?? 'That code isn’t valid.'}</p>
          )}
        </div>

        <div className="pos-cart-page__totals">
          <div className="pos-cart-page__subline"><span>Subtotal</span><span>{formatMoney(subtotal, currency)}</span></div>
          {discount > 0 && (
            <div className="pos-cart-page__subline pos-cart-page__subline--discount">
              <span>Discount</span><span>−{formatMoney(discount, currency)}</span>
            </div>
          )}
          {tax > 0 && (
            <div className="pos-cart-page__subline">
              <span>{taxLabel}{taxInclusive ? ' (incl.)' : ''}</span><span>{formatMoney(tax, currency)}</span>
            </div>
          )}
          <div className="pos-cart-page__total">Total <strong>{formatMoney(total, currency)}</strong></div>
        </div>

        {error && <div className="err">Error: {error}</div>}
        <button className="pos-side-cart__checkout" type="submit" disabled={!canSubmit}>
          {submitting ? 'Placing order…' : 'Place order'}
        </button>
    </form>
  );
}
