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

  function load() { bookingPublicApi.getManage(token).then(setView).catch(() => setError('not_found')); }
  useEffect(load, [token]);

  async function cancel() {
    setBusy(true);
    try { await bookingPublicApi.cancelManage(token); load(); }
    catch { setError('cancel_failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="booking-sf">
      <div className="booking-sf-col">
        <header className="booking-sf-header">
          <span className="booking-sf-brandline">Your appointment</span>
          <h1 className="booking-sf-title">Manage booking</h1>
        </header>

        <div className="booking-sf-body">
          {error === 'not_found' ? <p className="booking-sf-empty">This booking link is invalid or expired.</p>
            : !view ? <div className="booking-sf-empty">Loading…</div>
            : (
              <div className="booking-sf-step-panel">
                <div className="booking-summary-card">
                  <div className="booking-summary-row"><span className="muted">When</span><span>{formatDateLong(view.start_at)}, {formatTime(view.start_at)}–{formatTime(view.end_at)}</span></div>
                  <div className="booking-summary-row"><span className="muted">Name</span><span>{view.customer_name}</span></div>
                  <div className="booking-summary-row"><span className="muted">Status</span><span className={`booking-status booking-status-${view.status}`}>{view.status.replace('_', ' ')}</span></div>
                </div>

                {error === 'cancel_failed' ? <p className="error">Couldn’t cancel — please try again.</p> : null}

                {view.cancellable ? (
                  <button className="btn btn-danger booking-sf-cta" onClick={cancel} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel booking'}</button>
                ) : view.status === 'cancelled' ? (
                  <p className="booking-sf-empty">This booking has been cancelled.</p>
                ) : (
                  <p className="booking-sf-empty">This booking can no longer be cancelled online. Please contact the venue.</p>
                )}
              </div>
            )}
        </div>
        <footer className="booking-sf-footer">Powered by ExSol</footer>
      </div>
    </div>
  );
}
