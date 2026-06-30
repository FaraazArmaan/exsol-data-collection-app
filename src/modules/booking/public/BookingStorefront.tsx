import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ServicePicker } from './ServicePicker';
import { SlotPicker } from './SlotPicker';
import { Checkout } from './Checkout';
import { Confirmation } from './Confirmation';
import { type PublicService, type Slot, type CreateResult } from '../api';

type Step = 'service' | 'slot' | 'checkout' | 'done';

// Anonymous public storefront mounted at /c/:slug/book (outside the auth gate).
export default function BookingStorefront() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [step, setStep] = useState<Step>('service');
  const [service, setService] = useState<PublicService | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reset() {
    setService(null); setSlot(null); setResult(null); setNotice(null); setStep('service');
  }

  return (
    <div className="page-narrow booking-storefront">
      <h1 className="page-title">Book an appointment</h1>
      {notice ? <p className="error">{notice}</p> : null}

      {step === 'service' && (
        <ServicePicker slug={slug} onPick={(s) => { setService(s); setNotice(null); setStep('slot'); }} />
      )}

      {step === 'slot' && service && (
        <SlotPicker slug={slug} service={service}
          onPick={(sl) => { setSlot(sl); setNotice(null); setStep('checkout'); }}
          onBack={() => setStep('service')} />
      )}

      {step === 'checkout' && service && slot && (
        <Checkout slug={slug} service={service} slot={slot}
          onDone={(r) => { setResult(r); setStep('done'); }}
          onSlotTaken={() => { setNotice('That time was just taken — please pick another.'); setStep('slot'); }}
          onBack={() => setStep('slot')} />
      )}

      {step === 'done' && service && slot && result && (
        <Confirmation slug={slug} service={service} slot={slot} result={result} onBookAnother={reset} />
      )}
    </div>
  );
}
