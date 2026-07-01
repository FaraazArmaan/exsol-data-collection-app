import { useEffect, useState } from 'react';
import { bookingPublicApi, BookingApiError, type PublicService } from '../api';
import { formatRupees, paymentChip } from '../format';

interface Props {
  slug: string;
  onPick: (service: PublicService) => void;
}

export function ServicePicker({ slug, onPick }: Props) {
  const [services, setServices] = useState<PublicService[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    bookingPublicApi.services(slug)
      .then((r) => { if (!cancel) setServices(r.services); })
      .catch((e) => { if (!cancel) setError(e instanceof BookingApiError && e.status === 404 ? 'not_found' : 'load_error'); });
    return () => { cancel = true; };
  }, [slug]);

  if (error === 'not_found') return <p className="booking-sf-empty">This booking page doesn’t exist.</p>;
  if (error) return <p className="booking-sf-empty">Couldn’t load services. Please try again.</p>;
  if (!services) return <div className="booking-sf-empty">Loading services…</div>;
  if (services.length === 0) return <p className="booking-sf-empty">No services are available to book right now.</p>;

  return (
    <div className="booking-service-list">
      <h2 className="booking-sf-heading">Choose a service</h2>
      <div className="booking-service-cards">
        {services.map((s) => {
          const chip = paymentChip(s.payment_mode, s.deposit_cents);
          return (
            <button key={s.id} className="booking-service-card" onClick={() => onPick(s)}>
              <span className="booking-service-main">
                <span className="booking-service-name">{s.name}</span>
                <span className="booking-service-meta">{s.duration_min} min{chip ? ` · ${chip}` : ''}</span>
              </span>
              <span className="booking-service-right">
                <span className="booking-service-price">{formatRupees(s.price_cents)}</span>
                <span className="booking-service-arrow" aria-hidden>›</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
