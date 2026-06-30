import { Link } from 'react-router-dom';
import { type PublicService, type Slot, type CreateResult } from '../api';
import { formatTime, formatDateLong } from '../format';

interface Props {
  slug: string;
  service: PublicService;
  slot: Slot;
  result: CreateResult;
  onBookAnother: () => void;
}

export function Confirmation({ slug, service, slot, result, onBookAnother }: Props) {
  const pendingPayment = result.status === 'pending' && !!result.payment_intent;

  return (
    <div className="booking-confirmation">
      <div className={`booking-confirm-badge ${pendingPayment ? 'pending' : 'ok'}`}>{pendingPayment ? '⏳' : '✓'}</div>
      <h2 className="section-title">{pendingPayment ? 'Almost there' : 'You’re booked!'}</h2>

      <div className="card booking-summary">
        <div><strong>{service.name}</strong> · {service.duration_min} min</div>
        <div className="muted">{formatDateLong(slot.start)} · {formatTime(slot.start)}–{formatTime(slot.end)}</div>
      </div>

      {pendingPayment ? (
        // Live Razorpay Checkout is wired at deploy time (order-create needs RAZORPAY_* keys).
        // Until then the booking holds as `pending` and the payment webhook confirms it.
        <p className="muted">
          Online payment isn’t enabled in this preview yet. Your slot is held — complete payment when prompted and it’ll be confirmed automatically.
        </p>
      ) : (
        <p className="muted">We’ve emailed you a link to view or cancel this booking.</p>
      )}

      <div className="booking-actions">
        <Link className="btn btn-ghost" to={`/c/${slug}/book/manage/${result.manage_token}`}>Manage booking</Link>
        <button className="btn btn-secondary" onClick={onBookAnother}>Book another</button>
      </div>
    </div>
  );
}
