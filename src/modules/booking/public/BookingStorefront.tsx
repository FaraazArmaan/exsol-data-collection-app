import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ServicePicker } from './ServicePicker';
import { SlotPicker } from './SlotPicker';
import { Checkout } from './Checkout';
import { Confirmation } from './Confirmation';
import { bookingPublicApi, type PublicService, type Slot, type CreateResult } from '../shared/api';

type Step = 'service' | 'slot' | 'checkout' | 'done';
const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'service', label: 'Service' },
  { key: 'slot', label: 'Time' },
  { key: 'checkout', label: 'Details' },
];

// Anonymous public storefront mounted at /c/:slug/book (outside the auth gate).
export default function BookingStorefront() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [tenant, setTenant] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('service');
  const [services, setServices] = useState<PublicService[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeIndex = step === 'done' ? STEPS.length : STEPS.findIndex((s) => s.key === step);

  useEffect(() => {
    let cancel = false;
    bookingPublicApi
      .tenant(slug)
      .then((r) => {
        if (!cancel) setTenant(r.client.name);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [slug]);

  function reset() {
    setServices([]);
    setSlot(null);
    setResult(null);
    setNotice(null);
    setStep('service');
  }

  return (
    <div className="booking-sf">
      <div className="booking-sf-col">
        <header className="booking-sf-header">
          {tenant ? (
            <div className="booking-sf-avatar" aria-hidden>
              {tenant.charAt(0).toUpperCase()}
            </div>
          ) : null}
          <span className="booking-sf-brandline">Online booking</span>
          <h1 className="booking-sf-title">{tenant ?? 'Book an appointment'}</h1>
          {tenant ? <p className="booking-sf-sub">Book an appointment</p> : null}
        </header>

        {step !== 'done' && (
          <ol className="booking-sf-steps" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li
                key={s.key}
                className={`booking-sf-step${i === activeIndex ? ' is-active' : ''}${i < activeIndex ? ' is-done' : ''}`}
              >
                <span className="booking-sf-step-dot">{i < activeIndex ? '✓' : i + 1}</span>
                <span className="booking-sf-step-label">{s.label}</span>
              </li>
            ))}
          </ol>
        )}

        {notice ? <p className="booking-sf-notice">{notice}</p> : null}

        <div className="booking-sf-body">
          {step === 'service' && (
            <ServicePicker
              slug={slug}
              onPick={(selected) => {
                setServices(selected);
                setNotice(null);
                setStep('slot');
              }}
            />
          )}

          {step === 'slot' && services.length > 0 && (
            <SlotPicker
              slug={slug}
              services={services}
              onPick={(sl) => {
                setSlot(sl);
                setNotice(null);
                setStep('checkout');
              }}
              onBack={() => setStep('service')}
            />
          )}

          {step === 'checkout' && services.length > 0 && slot && (
            <Checkout
              slug={slug}
              services={services}
              slot={slot}
              onDone={(r) => {
                setResult(r);
                setStep('done');
              }}
              onSlotTaken={() => {
                setNotice('That time was just taken — please pick another.');
                setStep('slot');
              }}
              onBack={() => setStep('slot')}
            />
          )}

          {step === 'done' && services.length > 0 && slot && result && (
            <Confirmation
              slug={slug}
              services={services}
              slot={slot}
              result={result}
              onBookAnother={reset}
            />
          )}
        </div>

        <footer className="booking-sf-footer">Powered by ExSol</footer>
      </div>
    </div>
  );
}
