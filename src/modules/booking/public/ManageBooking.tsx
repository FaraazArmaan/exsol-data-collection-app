import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { bookingPublicApi, type ManageView } from '../api';
import { formatTime, formatDateLong } from '../format';

// Anonymous magic-link page at /c/:slug/book/manage/:token — view + cancel a booking.
export default function ManageBooking() {
  const { token = '' } = useParams<{ token: string }>();
  const [view, setView] = useState<ManageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    bookingPublicApi.getManage(token).then(setView).catch(() => setError('not_found'));
  }
  useEffect(load, [token]);

  async function cancel() {
    setBusy(true);
    try { await bookingPublicApi.cancelManage(token); load(); }
    catch { setError('cancel_failed'); }
    finally { setBusy(false); }
  }

  if (error === 'not_found') return <div className="page-narrow"><p className="error">This booking link is invalid or expired.</p></div>;
  if (!view) return <div className="page-narrow muted">Loading…</div>;

  return (
    <div className="page-narrow booking-manage">
      <h1 className="page-title">Your booking</h1>
      <div className="card booking-summary">
        <div className="muted">{formatDateLong(view.start_at)} · {formatTime(view.start_at)}–{formatTime(view.end_at)}</div>
        <div>Status: <strong>{view.status}</strong></div>
        <div className="muted">{view.customer_name}</div>
      </div>

      {error === 'cancel_failed' ? <p className="error">Couldn’t cancel — please try again.</p> : null}

      {view.cancellable ? (
        <button className="btn btn-danger" onClick={cancel} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel booking'}</button>
      ) : view.status === 'cancelled' ? (
        <p className="muted">This booking has been cancelled.</p>
      ) : (
        <p className="muted">This booking can no longer be cancelled online. Please contact the venue.</p>
      )}
    </div>
  );
}
