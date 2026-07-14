import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { bookingPublicApi, type ManageView, type PublicService } from '../shared/api';
import { formatTime, formatDateLong } from '../format';
import { SlotPicker } from './SlotPicker';

// Anonymous magic-link page at /book/:slug/manage/:token — view + cancel/reschedule.
export default function ManageBooking() {
  const { token = '' } = useParams<{ token: string }>();
  const [view, setView] = useState<ManageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);

  function load() {
    bookingPublicApi
      .getManage(token)
      .then(setView)
      .catch(() => setError('not_found'));
  }
  useEffect(load, [token]);

  async function cancel() {
    setBusy(true);
    try {
      await bookingPublicApi.cancelManage(token);
      load();
    } catch {
      setError('cancel_failed');
    } finally {
      setBusy(false);
    }
  }
  async function reschedule(startIso: string) {
    try {
      await bookingPublicApi.rescheduleManage(token, startIso);
      setRescheduling(false);
      load();
    } catch {
      setError('cancel_failed');
    }
  }
  const services: PublicService[] = view?.services?.length
    ? view.services
    : view
      ? [
          {
            id: view.service_id,
            name: view.service_name,
            duration_min: view.duration_min,
            price_cents: view.price_cents,
            payment_mode: 'pay_at_venue',
            deposit_cents: null,
          },
        ]
      : [];

  return (
    <div className="booking-sf">
      <div className="booking-sf-col">
        <header className="booking-sf-header">
          <span className="booking-sf-brandline">Your appointment</span>
          <h1 className="booking-sf-title">Manage booking</h1>
        </header>

        <div className="booking-sf-body">
          {error === 'not_found' ? (
            <p className="booking-sf-empty">This booking link is invalid or expired.</p>
          ) : !view ? (
            <div className="booking-sf-empty">Loading…</div>
          ) : rescheduling && services.length ? (
            <SlotPicker
              slug={view.slug}
              services={services}
              onPick={(s) => reschedule(s.start)}
              onBack={() => setRescheduling(false)}
            />
          ) : (
            <div className="booking-sf-step-panel">
              <div className="booking-summary-card">
                <div className="booking-summary-row">
                  <span className="muted">Services</span>
                  <span>{services.map((service) => service.name).join(', ')}</span>
                </div>
                <div className="booking-summary-row">
                  <span className="muted">When</span>
                  <span>
                    {formatDateLong(view.start_at)}, {formatTime(view.start_at)}–
                    {formatTime(view.end_at)}
                  </span>
                </div>
                <div className="booking-summary-row">
                  <span className="muted">Name</span>
                  <span>{view.customer_name}</span>
                </div>
                <div className="booking-summary-row">
                  <span className="muted">Status</span>
                  <span className={`booking-status booking-status-${view.status}`}>
                    {view.status.replace('_', ' ')}
                  </span>
                </div>
              </div>

              {view.policy ? (
                <p className="muted">
                  Online changes: cancel up to {view.policy.cancel_cutoff_min} minutes before;
                  reschedule up to {view.policy.reschedule_cutoff_min} minutes before (
                  {view.reschedule_count ?? 0}/{view.policy.max_customer_reschedules} used).
                </p>
              ) : null}

              {error === 'cancel_failed' ? (
                <p className="error">Something went wrong — please try again.</p>
              ) : null}

              {view.reschedulable ? (
                <button
                  className="btn btn-primary booking-sf-cta"
                  onClick={() => {
                    setError(null);
                    setRescheduling(true);
                  }}
                  disabled={busy}
                >
                  Reschedule
                </button>
              ) : null}
              {view.cancellable ? (
                <button className="btn btn-danger booking-sf-cta" onClick={cancel} disabled={busy}>
                  {busy ? 'Cancelling…' : 'Cancel booking'}
                </button>
              ) : view.status === 'cancelled' ? (
                <p className="booking-sf-empty">This booking has been cancelled.</p>
              ) : (
                <p className="booking-sf-empty">
                  This booking can no longer be changed online. Please contact the venue.
                </p>
              )}
            </div>
          )}
        </div>
        <footer className="booking-sf-footer">Powered by ExSol</footer>
      </div>
    </div>
  );
}
