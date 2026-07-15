import { useState, type FormEvent } from 'react';
import {
  bookingPublicApi,
  BookingApiError,
  type PublicService,
  type Slot,
  type CreateResult,
} from '../shared/api';
import { formatRupees, formatTime, formatDateLong, paymentChip } from '../format';
import { loadRazorpayCheckout } from '../../../lib/razorpay-checkout';

interface Props {
  slug: string;
  services: PublicService[];
  slot: Slot;
  onDone: (result: CreateResult) => void;
  onSlotTaken: () => void;
  onBack: () => void;
}

const LS_KEY = 'booking-customer';
function loadCustomer() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function Checkout({ slug, services, slot, onDone, onSlotTaken, onBack }: Props) {
  const last = loadCustomer();
  const [name, setName] = useState<string>(last.name ?? '');
  const [phone, setPhone] = useState<string>(last.phone ?? '');
  const [email, setEmail] = useState<string>(last.email ?? '');
  const [hp, setHp] = useState(''); // honeypot — must stay empty
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const total = services.reduce((sum, service) => sum + service.price_cents, 0);
  const paymentService = services.find((service) => service.payment_mode !== 'pay_at_venue');
  const chip = paymentService
    ? paymentChip(paymentService.payment_mode, paymentService.deposit_cents)
    : null;
  const canSubmit = name.trim() && phone.trim() && consent && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await bookingPublicApi.create(slug, {
        service_ids: services.map((service) => service.id),
        resource_id: slot.resource_id,
        start: slot.start,
        customer: { name: name.trim(), phone: phone.trim(), email: email.trim() || undefined },
        hp, // honeypot — server rejects if non-empty
      });
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim() }),
      );
      if (result.payment_intent?.status === 'created') {
        await loadRazorpayCheckout();
        const Razorpay = window.Razorpay;
        if (!Razorpay) throw new Error('razorpay_unavailable');
        new Razorpay({
          key: result.payment_intent.key_id,
          order_id: result.payment_intent.order_id,
          amount: result.payment_intent.amount_cents,
          currency: result.payment_intent.currency,
          name: 'ExSol booking',
          prefill: { name: name.trim(), contact: phone.trim(), email: email.trim() || undefined },
          // Razorpay's browser callback is only a customer-experience signal.
          // The signed webhook is the sole authority that confirms the visit.
          handler: () => onDone({ ...result, payment_intent: { ...result.payment_intent!, status: 'awaiting_webhook' } }),
          modal: { ondismiss: () => { setSubmitting(false); setError('Payment was not completed. Your held slot will expire shortly.'); } },
        }).open();
        return;
      }
      onDone(result);
    } catch (err) {
      setSubmitting(false);
      if (
        err instanceof BookingApiError &&
        (err.code === 'slot_taken' || err.code === 'no_resource_available')
      ) {
        onSlotTaken();
        return;
      }
      if (err instanceof BookingApiError && err.code === 'rate_limited') {
        setError('Too many attempts — please wait a moment.');
        return;
      }
      setError('Couldn’t book — please try again.');
    }
  }

  return (
    <form className="booking-sf-step-panel" onSubmit={handleSubmit}>
      <button type="button" className="booking-sf-back" onClick={onBack}>
        ← Times
      </button>
      <h2 className="booking-sf-heading">Confirm your booking</h2>

      <div className="booking-summary-card">
        <div className="booking-summary-row">
          <span className="muted">Services</span>
          <span>{services.map((service) => service.name).join(', ')}</span>
        </div>
        <div className="booking-summary-row">
          <span className="muted">When</span>
          <span>
            {formatDateLong(slot.start)}, {formatTime(slot.start)}–{formatTime(slot.end)}
          </span>
        </div>
        <div className="booking-summary-row booking-summary-total">
          <span>Total</span>
          <span>
            {formatRupees(total)}
            {chip ? <span className="booking-chip">{chip}</span> : null}
          </span>
        </div>
      </div>

      <label>
        Name *
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          placeholder="Your name"
        />
      </label>
      <label>
        Phone *
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          inputMode="tel"
          placeholder="Mobile number"
        />
      </label>
      <label>
        Email
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          placeholder="For your confirmation (optional)"
        />
      </label>
      {/* Honeypot: hidden from humans, tempting to bots. */}
      <input
        className="booking-hp"
        tabIndex={-1}
        autoComplete="off"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        aria-hidden
      />
      <label className="booking-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>I agree to the booking terms.</span>
      </label>

      {paymentService ? (
        <p className="muted">A {chip?.toLowerCase()} is required — you’ll pay after confirming.</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}

      <button type="submit" className="btn btn-primary booking-sf-cta" disabled={!canSubmit}>
        {submitting ? 'Booking…' : paymentService ? 'Continue to payment' : 'Confirm booking'}
      </button>
    </form>
  );
}
