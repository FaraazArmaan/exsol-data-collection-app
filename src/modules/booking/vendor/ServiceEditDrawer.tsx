import { useState } from 'react';
import { bookingApi, type VendorService, type VendorResource, type PaymentMode } from '../shared/api';
import { ONLINE_PAYMENTS_ENABLED } from '../config';

interface Props {
  service: VendorService;
  resources: VendorResource[];
  onClose: () => void;
  onSaved: () => void;
}

export function ServiceEditDrawer({ service, resources, onClose, onSaved }: Props) {
  const [name, setName] = useState(service.name);
  const [duration, setDuration] = useState(service.duration_min);
  const [price, setPrice] = useState(service.price_cents);
  const [buffer, setBuffer] = useState(service.buffer_min);
  const [mode, setMode] = useState<PaymentMode>(service.payment_mode);
  const [deposit, setDeposit] = useState(service.deposit_cents ?? 0);
  const [eligible, setEligible] = useState<string[]>(service.eligible_resource_ids ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    try {
      await bookingApi.patchService(service.id, {
        name: name.trim(), duration_min: duration, price_cents: price, buffer_min: buffer,
        eligible_resource_ids: eligible,
        ...(ONLINE_PAYMENTS_ENABLED ? { payment_mode: mode, deposit_cents: mode === 'deposit' ? deposit : null } : {}),
      });
      onSaved(); onClose();
    } catch (e: any) { setError(e?.code ?? 'save_error'); setBusy(false); }
  }

  return (
    <aside role="dialog" aria-label="Edit service" className="pos-drawer booking-drawer">
      <div className="booking-drawer-head">
        <h2 className="section-title">Edit service</h2>
        <button className="btn btn-ghost" onClick={onClose}>✕</button>
      </div>
      <div className="booking-form">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Duration (min)<input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></label>
        <label>Price (₹)<input type="number" min={0} value={price / 100} onChange={(e) => setPrice(Math.round(Number(e.target.value) * 100))} /></label>
        <label>Buffer after (min)<input type="number" min={0} value={buffer} onChange={(e) => setBuffer(Number(e.target.value))} /></label>
        {ONLINE_PAYMENTS_ENABLED ? (
          <>
            <label>Payment<select value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
              <option value="pay_at_venue">Pay at venue</option><option value="deposit">Deposit</option><option value="full_upfront">Full upfront</option>
            </select></label>
            {mode === 'deposit' ? <label>Deposit (₹)<input type="number" min={0} value={deposit / 100} onChange={(e) => setDeposit(Math.round(Number(e.target.value) * 100))} /></label> : null}
          </>
        ) : null}
        {resources.length ? (
          <fieldset className="booking-eligible">
            <legend className="muted">Eligible resources (none = all)</legend>
            {resources.map((r) => (
              <label key={r.id} className="booking-consent">
                <input type="checkbox" checked={eligible.includes(r.id)}
                  onChange={(e) => setEligible((prev) => e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id))} />
                <span>{r.name}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {error ? <p className="error">Couldn’t save ({error}).</p> : null}
        <button className="btn btn-primary" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save service'}</button>
      </div>
    </aside>
  );
}
