import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createCartStore } from '../store/cart';
import { CartLineRow } from '../components/CartLineRow';
import { CustomerForm } from '../components/CustomerForm';
import { ChannelPicker } from '../components/ChannelPicker';
import { posApi, PosApiError, type SaleQuote } from '../shared/api';
import { formatRupees } from '../lib/money';
import { loadRazorpayCheckout } from '../../../lib/razorpay-checkout';

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
  const [couponCode, setCouponCode] = useState('');
  const [quote, setQuote] = useState<SaleQuote | null>(null);
  const [quoteState, setQuoteState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

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
  const quoteKey = useMemo(() => JSON.stringify({ lines: lines.map((line) => ({ productId: line.productId, variantId: line.variantId, qty: line.qty })), customer, channel, couponCode: couponCode.trim() || undefined }), [lines, customer, channel, couponCode]);

  useEffect(() => {
    if (!validity.ok) {
      setQuote(null);
      setQuoteState('idle');
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    setQuoteState('loading');
    setQuoteError(null);
    const timer = window.setTimeout(() => {
      posApi.quoteSale({ channel, customer: { ...customer, email: customer.email || undefined }, lines: lines.map((line) => ({ productId: line.productId, variantId: line.variantId, qty: line.qty })), couponCode: couponCode.trim() || undefined })
        .then((next) => { if (!cancelled) { setQuote(next); setQuoteState('ready'); } })
        .catch((nextError) => { if (!cancelled) { setQuoteState('error'); setQuoteError(nextError instanceof PosApiError ? nextError.code : 'network_error'); } });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [quoteKey, refreshNonce, validity.ok]);

  async function submit() {
    if (!quote || quoteState !== 'ready') return;
    setSubmitting(true);
    setError(null);
    try {
      const sale = await posApi.createSale({
        channel,
        idempotencyKey,
        customer: { ...customer, email: customer.email || undefined },
        lines: lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty })),
        couponCode: couponCode.trim() || undefined,
        quoteId: quote.quoteId,
      });
      if (sale.payment_intent) {
        await loadRazorpayCheckout();
        const Razorpay = window.Razorpay;
        if (!Razorpay) throw new Error('razorpay_unavailable');
        new Razorpay({
          key: sale.payment_intent.key_id, order_id: sale.payment_intent.order_id,
          amount: sale.payment_intent.amount_cents, currency: sale.payment_intent.currency,
          name: 'ExSol POS sale', prefill: { name: customer.name.trim(), contact: customer.phone.trim(), email: customer.email || undefined },
          handler: () => { clear(); nav(`/c/${props.slug}/pos/sales/${sale.id}`); },
          modal: { ondismiss: () => { setSubmitting(false); setError('Payment was not completed. The sale remains pending payment.'); } },
        }).open();
        return;
      }
      clear();
      nav(`/c/${props.slug}/pos/sales/${sale.id}`);
    } catch (e) {
      if (e instanceof PosApiError && e.code === 'quote_changed') {
        const next = (e.details as { quote?: SaleQuote } | undefined)?.quote;
        if (next) { setQuote(next); setQuoteState('ready'); }
      }
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
              key={l.key}
              line={l}
              onQty={(q) => setQty(l.key, q)}
              onRemove={() => removeLine(l.key)}
            />
          ))}
          <div className="pos-cart-page__totals" aria-live="polite">
            <div className="pos-cart-page__subline"><span>Subtotal</span><span>{formatRupees(quote?.subtotalCents ?? subtotal)}</span></div>
            {quote && quote.discountCents > 0 ? <div className="pos-cart-page__subline pos-cart-page__subline--discount"><span>Discount</span><span>−{formatRupees(quote.discountCents)}</span></div> : null}
            {quote && quote.taxCents > 0 ? <div className="pos-cart-page__subline"><span>{quote.taxLabel}{quote.taxInclusive ? ' (incl.)' : ''}</span><span>{formatRupees(quote.taxCents)}</span></div> : null}
            <div className="pos-cart-page__total">Total <strong>{formatRupees(quote?.totalCents ?? subtotal)}</strong></div>
          </div>
        </section>
        <section className="pos-cart-page__customer">
          <h2>Customer</h2>
          <CustomerForm value={customer} onChange={(p) => setCustomer(p)} />
          <h2>Channel</h2>
          <ChannelPicker value={channel} onChange={(c) => setChannel(c)} />
          <div className="pos-coupon">
            {couponCode ? <div className="pos-coupon__applied"><span>Coupon <strong>{couponCode}</strong> {quoteState === 'ready' ? 'applied' : 'updating'}</span><button type="button" className="pos-coupon__remove" onClick={() => setCouponCode('')}>Remove</button></div> : <div className="pos-coupon__row"><input className="pos-coupon__input" aria-label="Coupon code" placeholder="Coupon code" value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} /></div>}
          </div>
          <p className={quoteState === 'error' ? 'pos-coupon__err' : 'muted'} role="status">
            {quoteState === 'loading' ? 'Updating total…' : quoteState === 'ready' ? 'Total updated. Ready to take payment.' : quoteState === 'error' ? `Could not update total: ${quoteError}` : 'Add customer details to calculate total.'}
          </p>
          {quoteState === 'error' ? <button type="button" className="pos-cart-page__refresh" onClick={() => setRefreshNonce((value) => value + 1)}>Refresh total</button> : null}
          {error ? <div className="err">Error: {error}</div> : null}
          <button onClick={submit} disabled={!validity.ok || quoteState !== 'ready' || submitting}>
            {submitting ? 'Submitting…' : 'Submit & take payment'}
          </button>
        </section>
      </div>
    </div>
  );
}
