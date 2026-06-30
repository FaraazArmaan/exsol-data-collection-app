import { useEffect, useState, type FormEvent } from 'react';
import { bookingApi, BookingApiError, type VendorService, type VendorResource, type PaymentMode } from '../api';
import { formatRupees } from '../format';
import { ONLINE_PAYMENTS_ENABLED } from '../config';

interface Props { slug: string; perms: ReadonlySet<string>; }

export default function ServicesPage({ perms }: Props) {
  const canEdit = perms.has('booking.employees.edit');
  const [services, setServices] = useState<VendorService[] | null>(null);
  const [resources, setResources] = useState<VendorResource[]>([]);
  const [error, setError] = useState<string | null>(null);

  // create-form state
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(30);
  const [price, setPrice] = useState(0);
  const [mode, setMode] = useState<PaymentMode>('pay_at_venue');
  const [deposit, setDeposit] = useState(0);
  const [eligible, setEligible] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function reload() { bookingApi.listServices().then((r) => setServices(r.services)).catch(() => setError('load_error')); }
  useEffect(() => { reload(); bookingApi.listResources().then((r) => setResources(r.resources)).catch(() => {}); }, []);

  async function create(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      await bookingApi.createService({
        name: name.trim(), duration_min: duration, price_cents: price, payment_mode: mode,
        deposit_cents: mode === 'deposit' ? deposit : undefined, eligible_resource_ids: eligible,
      } as any);
      setName(''); setPrice(0); setEligible([]); reload();
    } catch (e2) { setError(e2 instanceof BookingApiError ? e2.code : 'save_error'); }
    finally { setSaving(false); }
  }
  async function remove(id: string) { await bookingApi.deleteService(id); reload(); }

  if (error === 'load_error') return <p className="error">Couldn’t load services.</p>;
  if (!services) return <div className="muted">Loading…</div>;

  return (
    <div className="page booking-vendor">
      <h1 className="page-title">Services</h1>

      <table className="booking-table">
        <thead><tr><th>Name</th><th>Duration</th><th>Price</th><th>Payment</th>{canEdit ? <th></th> : null}</tr></thead>
        <tbody>
          {services.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td><td>{s.duration_min} min</td><td>{formatRupees(s.price_cents)}</td><td>{s.payment_mode.replace('_', ' ')}</td>
              {canEdit ? <td><button className="btn btn-ghost btn-danger" onClick={() => remove(s.id)}>Deactivate</button></td> : null}
            </tr>
          ))}
          {services.length === 0 ? <tr><td colSpan={5} className="muted">No services yet.</td></tr> : null}
        </tbody>
      </table>

      {canEdit ? (
        <form className="card booking-form" onSubmit={create}>
          <h2 className="section-title">Add a service</h2>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Duration (min)<input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></label>
          <label>Price (₹)<input type="number" min={0} value={price / 100} onChange={(e) => setPrice(Math.round(Number(e.target.value) * 100))} /></label>
          <label>Payment<select value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
            <option value="pay_at_venue">Pay at venue</option>
            {ONLINE_PAYMENTS_ENABLED ? <><option value="deposit">Deposit</option><option value="full_upfront">Full upfront</option></> : null}
          </select></label>
          {!ONLINE_PAYMENTS_ENABLED ? <p className="muted">Online payment (deposit / upfront) needs payment setup — coming soon.</p> : null}
          {ONLINE_PAYMENTS_ENABLED && mode === 'deposit' ? <label>Deposit (₹)<input type="number" min={0} value={deposit / 100} onChange={(e) => setDeposit(Math.round(Number(e.target.value) * 100))} /></label> : null}
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
          <button className="btn btn-primary" type="submit" disabled={saving || !name.trim()}>{saving ? 'Adding…' : 'Add service'}</button>
        </form>
      ) : null}
    </div>
  );
}
