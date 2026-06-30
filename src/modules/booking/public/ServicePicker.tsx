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

  if (error === 'not_found') return <p className="error">This booking page doesn’t exist.</p>;
  if (error) return <p className="error">Couldn’t load services. Please try again.</p>;
  if (!services) return <div className="muted">Loading services…</div>;
  if (services.length === 0) return <p className="muted">No services are available to book right now.</p>;

  return (
    <div className="booking-service-list">
      <h2 className="section-title">Choose a service</h2>
      <div className="grid">
        {services.map((s) => {
          const chip = paymentChip(s.payment_mode, s.deposit_cents);
          return (
            <button key={s.id} className="card booking-service-card" onClick={() => onPick(s)}>
              <span className="booking-service-name">{s.name}</span>
              <span className="muted">{s.duration_min} min</span>
              <span className="booking-service-price">{formatRupees(s.price_cents)}</span>
              {chip ? <span className="booking-chip">{chip}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
