import { useState, type FormEvent } from 'react';
import { bookingPublicApi, BookingApiError, type PublicService, type Slot, type CreateResult } from '../api';
import { formatRupees, formatTime, formatDateLong, paymentChip } from '../format';

interface Props {
  slug: string;
  service: PublicService;
  slot: Slot;
  onDone: (result: CreateResult) => void;
  onSlotTaken: () => void;
  onBack: () => void;
}

const LS_KEY = 'booking-customer';
function loadCustomer() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}'); } catch { return {}; }
}

export function Checkout({ slug, service, slot, onDone, onSlotTaken, onBack }: Props) {
  const last = loadCustomer();
  const [name, setName] = useState<string>(last.name ?? '');
  const [phone, setPhone] = useState<string>(last.phone ?? '');
  const [email, setEmail] = useState<string>(last.email ?? '');
  const [hp, setHp] = useState('');            // honeypot — must stay empty
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const chip = paymentChip(service.payment_mode, service.deposit_cents);
  const canSubmit = name.trim() && phone.trim() && consent && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (hp) return;                            // bot filled the honeypot — silently drop
    setError(null); setSubmitting(true);
    try {
      const result = await bookingPublicApi.create(slug, {
        service_id: service.id, resource_id: slot.resource_id, start: slot.start,
        customer: { name: name.trim(), phone: phone.trim(), email: email.trim() || undefined },
      });
      localStorage.setItem(LS_KEY, JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim() }));
      onDone(result);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof BookingApiError && (err.code === 'slot_taken' || err.code === 'no_resource_available')) { onSlotTaken(); return; }
      if (err instanceof BookingApiError && err.code === 'rate_limited') { setError('Too many attempts — please wait a moment.'); return; }
      setError('Couldn’t book — please try again.');
    }
  }

  return (
    <form className="booking-sf-step-panel" onSubmit={handleSubmit}>
      <button type="button" className="booking-sf-back" onClick={onBack}>← Times</button>
      <h2 className="booking-sf-heading">Confirm your booking</h2>

      <div className="booking-summary-card">
        <div className="booking-summary-row"><span className="muted">Service</span><span>{service.name}</span></div>
        <div className="booking-summary-row"><span className="muted">When</span><span>{formatDateLong(slot.start)}, {formatTime(slot.start)}–{formatTime(slot.end)}</span></div>
        <div className="booking-summary-row booking-summary-total"><span>Total</span><span>{formatRupees(service.price_cents)}{chip ? <span className="booking-chip">{chip}</span> : null}</span></div>
      </div>

      <label>Name *<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" /></label>
      <label>Phone *<input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" placeholder="Mobile number" /></label>
      <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" placeholder="For your confirmation (optional)" /></label>
      {/* Honeypot: hidden from humans, tempting to bots. */}
      <input className="booking-hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} aria-hidden />
      <label className="booking-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>I agree to the booking terms.</span>
      </label>

      {service.payment_mode !== 'pay_at_venue' ? (
        <p className="muted">A {chip?.toLowerCase()} is required — you’ll pay after confirming.</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}

      <button type="submit" className="btn btn-primary booking-sf-cta" disabled={!canSubmit}>
        {submitting ? 'Booking…' : service.payment_mode === 'pay_at_venue' ? 'Confirm booking' : 'Continue to payment'}
      </button>
    </form>
  );
}
