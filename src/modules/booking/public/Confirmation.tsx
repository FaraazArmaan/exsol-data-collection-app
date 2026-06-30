import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type PublicService, type Slot, type CreateResult } from '../api';
import { formatTime, formatDateLong } from '../format';
import { buildIcs, downloadIcs } from '../ics';

interface Props {
  slug: string;
  service: PublicService;
  slot: Slot;
  result: CreateResult;
  onBookAnother: () => void;
}

export function Confirmation({ slug, service, slot, result, onBookAnother }: Props) {
  const pendingPayment = result.status === 'pending' && !!result.payment_intent;
  const [copied, setCopied] = useState(false);
  const manageUrl = `${window.location.origin}/c/${slug}/book/manage/${result.manage_token}`;

  function copyLink() {
    navigator.clipboard?.writeText(manageUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }
  function addToCalendar() {
    downloadIcs('booking.ics', buildIcs({
      uid: `${result.manage_token}@exsol`, title: service.name, startIso: slot.start, endIso: slot.end,
    }));
  }

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
          Online payment isn’t enabled yet. Your slot is held — complete payment when prompted and it’ll be confirmed automatically.
        </p>
      ) : null}

      <div className="card booking-manage-link">
        <span className="muted">Save this link to view or cancel your booking:</span>
        <div className="booking-link-row">
          <input readOnly value={manageUrl} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-secondary" onClick={copyLink}>{copied ? 'Copied!' : 'Copy link'}</button>
        </div>
      </div>

      <div className="booking-actions">
        <button type="button" className="btn btn-secondary" onClick={addToCalendar}>Add to calendar</button>
        <Link className="btn btn-ghost" to={`/c/${slug}/book/manage/${result.manage_token}`}>Manage booking</Link>
        <button type="button" className="btn btn-ghost" onClick={onBookAnother}>Book another</button>
      </div>
    </div>
  );
}
