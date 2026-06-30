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
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const chip = paymentChip(service.payment_mode, service.deposit_cents);
  const canSubmit = name.trim() && phone.trim() && consent && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
      if (err instanceof BookingApiError && err.status === 409 && err.code === 'slot_taken') { onSlotTaken(); return; }
      if (err instanceof BookingApiError && err.code === 'no_resource_available') { onSlotTaken(); return; }
      setError(err instanceof BookingApiError ? err.code : 'network_error');
    }
  }

  return (
    <form className="booking-checkout" onSubmit={handleSubmit}>
      <button type="button" className="btn btn-ghost" onClick={onBack}>← Times</button>
      <h2 className="section-title">Confirm your booking</h2>

      <div className="card booking-summary">
        <div><strong>{service.name}</strong> · {service.duration_min} min</div>
        <div className="muted">{formatDateLong(slot.start)} · {formatTime(slot.start)}–{formatTime(slot.end)}</div>
        <div className="booking-summary-price">{formatRupees(service.price_cents)}{chip ? <span className="booking-chip">{chip}</span> : null}</div>
      </div>

      <label>Name *<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
      <label>Phone *<input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" /></label>
      <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" /></label>
      <label className="booking-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>I agree to the booking terms.</span>
      </label>

      {service.payment_mode !== 'pay_at_venue' ? (
        <p className="muted">A {chip?.toLowerCase()} is required. You’ll be taken to payment after confirming.</p>
      ) : null}
      {error ? <p className="error">Couldn’t book ({error}). Please try again.</p> : null}

      <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
        {submitting ? 'Booking…' : service.payment_mode === 'pay_at_venue' ? 'Confirm booking' : 'Continue to payment'}
      </button>
    </form>
  );
}
