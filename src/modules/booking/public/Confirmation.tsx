import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type PublicService, type Slot, type CreateResult } from '../shared/api';
import { formatTime, formatDateLong } from '../format';
import { buildIcs, downloadIcs } from '../ics';

interface Props {
  slug: string;
  services: PublicService[];
  slot: Slot;
  result: CreateResult;
  onBookAnother: () => void;
}

export function Confirmation({ slug, services, slot, result, onBookAnother }: Props) {
  const pendingPayment = result.status === 'pending' && !!result.payment_intent;
  const [copied, setCopied] = useState(false);
  const managePath = `/storefront/${slug}/Book/manage/${result.manage_token}`;
  const manageUrl = `${window.location.origin}${managePath}`;

  function copyLink() {
    navigator.clipboard
      ?.writeText(manageUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }
  function addToCalendar() {
    downloadIcs(
      'booking.ics',
      buildIcs({
        uid: `${result.manage_token}@exsol`,
        title: services.map((service) => service.name).join(', '),
        startIso: slot.start,
        endIso: slot.end,
      }),
    );
  }

  return (
    <div className="booking-sf-step-panel booking-confirm">
      <div className={`booking-confirm-badge ${pendingPayment ? 'pending' : 'ok'}`}>
        {pendingPayment ? '⏳' : '✓'}
      </div>
      <h2 className="booking-confirm-title">
        {pendingPayment ? 'Almost there' : 'You’re booked!'}
      </h2>
      <p className="booking-confirm-sub">
        {pendingPayment
          ? 'Your slot is held pending payment.'
          : `We’ll see you on ${formatDateLong(slot.start)}.`}
      </p>

      <div className="booking-summary-card">
        <div className="booking-summary-row">
          <span className="muted">Services</span>
          <span>
            {services.map((service) => service.name).join(', ')} ·{' '}
            {services.reduce((total, service) => total + service.duration_min, 0)} min
          </span>
        </div>
        <div className="booking-summary-row">
          <span className="muted">When</span>
          <span>
            {formatDateLong(slot.start)}, {formatTime(slot.start)}–{formatTime(slot.end)}
          </span>
        </div>
      </div>

      {pendingPayment ? (
        <p className="muted booking-confirm-note">
          Online payment isn’t enabled yet — your slot is held and will be confirmed automatically
          once payment is taken.
        </p>
      ) : null}

      <button type="button" className="btn btn-primary booking-sf-cta" onClick={addToCalendar}>
        Add to calendar
      </button>

      <div className="booking-manage-link">
        <span className="muted">Save this link to view or cancel your booking:</span>
        <div className="booking-link-row">
          <input readOnly value={manageUrl} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-secondary" onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="booking-confirm-actions">
        <Link className="booking-sf-back" to={managePath}>
          Manage booking
        </Link>
        <button type="button" className="booking-sf-back" onClick={onBookAnother}>
          Book another →
        </button>
      </div>
    </div>
  );
}
