import { useEffect, useState } from 'react';
import { useUserAuth } from '../../user-portal/user-auth-context';

interface FeatureState {
  enabled: boolean;
  publicUrl: string;
  ready: boolean;
  error: string | null;
}

const unavailable: FeatureState = { enabled: false, publicUrl: '', ready: false, error: null };

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: 'include', ...init });
  return { response, body: await response.json().catch(() => null) };
}

export default function StorefrontSettings() {
  const { user, client, permissions } = useUserAuth();
  const canEdit =
    !!user &&
    (user.level_number == null ||
      user.level_number === 1 ||
      permissions['_platform.settings.edit'] === true);

  const [ordering, setOrdering] = useState<FeatureState>(unavailable);
  const [booking, setBooking] = useState<FeatureState>(unavailable);
  const [loading, setLoading] = useState(true);
  const [orderingBusy, setOrderingBusy] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);

  useEffect(() => {
    if (!canEdit) {
      setLoading(false);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const [orderingResult, bookingResult] = await Promise.all([
          api('/api/client-settings/storefront'),
          api('/api/booking/publication'),
        ]);
        if (cancel) return;
        setOrdering({
          enabled: !!orderingResult.body?.enabled,
          publicUrl: orderingResult.body?.publicUrl ?? '',
          ready: orderingResult.response.ok,
          error: orderingResult.response.ok
            ? null
            : (orderingResult.body?.error?.code ?? 'load_error'),
        });
        setBooking({
          enabled: !!bookingResult.body?.enabled,
          publicUrl: bookingResult.body?.publicUrl ?? `/storefront/${client?.slug ?? ''}/Book`,
          ready: !!bookingResult.body?.ready,
          error: bookingResult.response.ok
            ? null
            : (bookingResult.body?.error?.code ?? 'booking_not_ready'),
        });
      } catch {
        if (!cancel) {
          setOrdering((current) => ({ ...current, error: 'network_error' }));
          setBooking((current) => ({ ...current, error: 'network_error' }));
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [canEdit, client?.slug]);

  async function toggleOrdering(next: boolean) {
    setOrderingBusy(true);
    try {
      const { response, body } = await api('/api/client-settings/storefront', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (response.ok)
        setOrdering({
          enabled: !!body.enabled,
          publicUrl: body.publicUrl ?? '',
          ready: true,
          error: null,
        });
      else setOrdering((current) => ({ ...current, error: body?.error?.code ?? 'save_error' }));
    } catch {
      setOrdering((current) => ({ ...current, error: 'network_error' }));
    } finally {
      setOrderingBusy(false);
    }
  }

  async function toggleBooking(next: boolean) {
    setBookingBusy(true);
    try {
      const { response, body } = await api('/api/booking/publication', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (response.ok)
        setBooking({
          enabled: !!body.enabled,
          publicUrl: body.publicUrl ?? '',
          ready: !!body.ready,
          error: null,
        });
      else setBooking((current) => ({ ...current, error: body?.error?.code ?? 'save_error' }));
    } catch {
      setBooking((current) => ({ ...current, error: 'network_error' }));
    } finally {
      setBookingBusy(false);
    }
  }

  if (!canEdit) return <p className="muted">You don’t have access to storefront settings.</p>;
  if (loading) return <p className="muted">Loading…</p>;

  const storefrontUrl = ordering.publicUrl.replace(/\/Order$/, '');

  return (
    <section className="storefront-settings page-narrow">
      <h1 className="page-title">Storefront</h1>
      <p className="muted">
        Link to storefront site: <a href={storefrontUrl}>{storefrontUrl}</a>
      </p>
      <div className="card storefront-settings__summary">
        <h2 className="section-title">Customer features</h2>
        <p className="muted">
          Turn each feature on or off for your single branded storefront. Enabled features appear
          as tabs in its navigation.
        </p>
      </div>
      <div className="storefront-settings__features">
        <article className="card storefront-settings__feature">
          <div className="storefront-settings__feature-copy">
            <h2 className="section-title">Online booking</h2>
            <p className="muted">
              Let customers choose an available time through your storefront.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={booking.enabled}
            aria-label="Online booking"
            className="toggle"
            disabled={bookingBusy || (!booking.enabled && !booking.ready)}
            onClick={() => void toggleBooking(!booking.enabled)}
          >
            <span className="toggle-label toggle-label-on">ON</span>
            <span className="toggle-label toggle-label-off">OFF</span>
            <span className="toggle-knob" />
          </button>
          {booking.error ? <p className="error">Couldn’t save ({booking.error}).</p> : null}
          {!booking.enabled && !booking.ready ? (
            <p className="muted">
              Complete Booking Setup and add an active service before turning this on.
            </p>
          ) : null}
        </article>
        <article className="card storefront-settings__feature">
          <div className="storefront-settings__feature-copy">
            <h2 className="section-title">Online ordering</h2>
            <p className="muted">
              Let customers browse your menu and place pickup or delivery orders.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={ordering.enabled}
            aria-label="Online ordering"
            className="toggle"
            disabled={orderingBusy}
            onClick={() => void toggleOrdering(!ordering.enabled)}
          >
            <span className="toggle-label toggle-label-on">ON</span>
            <span className="toggle-label toggle-label-off">OFF</span>
            <span className="toggle-knob" />
          </button>
          {ordering.error ? <p className="error">Couldn’t save ({ordering.error}).</p> : null}
        </article>
      </div>
    </section>
  );
}
