import { useEffect, useState, type FormEvent } from 'react';
import { bookingApi, BookingApiError, type VendorService, type VendorResource, type PaymentMode } from '../shared/api';
import { formatRupees } from '../format';
import { ONLINE_PAYMENTS_ENABLED } from '../config';
import { BookingTabs } from './BookingTabs';
import { ServiceEditDrawer } from './ServiceEditDrawer';
import { Button } from '../../../components/ui/Button';
import { InlineNotice } from '../../../components/ui/Feedback';
import { Field, Input, Select } from '../../../components/ui/Field';

interface Props { slug: string; perms: ReadonlySet<string>; }

export default function ServicesPage({ slug, perms }: Props) {
  const canEdit = perms.has('booking.employees.edit');
  const [services, setServices] = useState<VendorService[] | null>(null);
  const [resources, setResources] = useState<VendorResource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<VendorService | null>(null);

  // create-form state
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(30);
  const [price, setPrice] = useState(0);
  const [mode, setMode] = useState<PaymentMode>('pay_at_venue');
  const [deposit, setDeposit] = useState(0);
  const [eligible, setEligible] = useState<string[]>([]);
  const [resourceScope, setResourceScope] = useState<'all' | 'selected'>('all');
  const [saving, setSaving] = useState(false);

  function reload() { bookingApi.listServices().then((r) => setServices(r.services)).catch(() => setError('load_error')); }
  useEffect(() => { reload(); bookingApi.listResources().then((r) => setResources(r.resources)).catch(() => {}); }, []);

  async function create(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      await bookingApi.createService({
        name: name.trim(), duration_min: duration, price_cents: price, payment_mode: mode,
        deposit_cents: mode === 'deposit' ? deposit : undefined, eligible_resource_ids: resourceScope === 'selected' ? eligible : [],
      } as any);
      setName(''); setPrice(0); setEligible([]); setResourceScope('all'); reload();
    } catch (e2) { setError(e2 instanceof BookingApiError ? e2.code : 'save_error'); }
    finally { setSaving(false); }
  }
  async function remove(id: string) { await bookingApi.deleteService(id); reload(); }

  if (error === 'load_error') return <p className="error">Couldn’t load services.</p>;
  if (!services) return <div className="muted">Loading…</div>;

  return (
    <div className="page booking-vendor">
      <BookingTabs slug={slug} perms={perms} />
      <h1 className="page-title">Services</h1>

      <table className="booking-table">
        <thead><tr><th>Name</th><th>Duration</th><th>Price</th><th>Payment</th>{canEdit ? <th></th> : null}</tr></thead>
        <tbody>
          {services.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td><td>{s.duration_min} min</td><td>{formatRupees(s.price_cents)}</td><td>{s.payment_mode.replace('_', ' ')}</td>
              {canEdit ? <td className="booking-row-actions">
                <button className="btn btn-ghost" onClick={() => setEditing(s)}>Edit</button>
                <button className="btn btn-ghost btn-danger" onClick={() => remove(s.id)}>Deactivate</button>
              </td> : null}
            </tr>
          ))}
          {services.length === 0 ? <tr><td colSpan={5} className="muted">No services yet.</td></tr> : null}
        </tbody>
      </table>

      {canEdit ? (
        <form className="card booking-form" onSubmit={create}>
          <h2 className="section-title">Add a service</h2>
          <div className="ui-form-grid ui-form-grid--two">
            <div className="ui-form-grid__full"><Field label="Name" required>{(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} />}</Field></div>
            <Field label="Duration (minutes)">{(props) => <Input {...props} type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />}</Field>
            <Field label="Price (₹)">{(props) => <Input {...props} type="number" min={0} value={price / 100} onChange={(e) => setPrice(Math.round(Number(e.target.value) * 100))} />}</Field>
            <div className="ui-form-grid__full"><Field label="Payment">{(props) => <Select {...props} value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
              <option value="pay_at_venue">Pay at venue</option>
              {ONLINE_PAYMENTS_ENABLED ? <><option value="deposit">Deposit</option><option value="full_upfront">Full upfront</option></> : null}
            </Select>}</Field></div>
            {!ONLINE_PAYMENTS_ENABLED ? <p className="muted ui-form-grid__full">Online payment (deposit / upfront) needs payment setup — coming soon.</p> : null}
            {ONLINE_PAYMENTS_ENABLED && mode === 'deposit' ? <div className="ui-form-grid__full"><Field label="Deposit (₹)">{(props) => <Input {...props} type="number" min={0} value={deposit / 100} onChange={(e) => setDeposit(Math.round(Number(e.target.value) * 100))} />}</Field></div> : null}
            {resources.length ? (
              <fieldset className="ui-choice-group ui-form-grid__full">
                <legend>Eligible resources</legend>
                <div className="ui-choice-switch" aria-label="Eligible resource scope">
                  <Button type="button" size="compact" variant={resourceScope === 'all' ? 'primary' : 'secondary'} aria-pressed={resourceScope === 'all'} onClick={() => setResourceScope('all')}>All resources</Button>
                  <Button type="button" size="compact" variant={resourceScope === 'selected' ? 'primary' : 'secondary'} aria-pressed={resourceScope === 'selected'} onClick={() => setResourceScope('selected')}>Choose resources</Button>
                </div>
                {resourceScope === 'all' ? <p className="muted">This service can be booked with any available resource.</p> : (
                  <>
                    <p className="muted">Choose at least one resource for this service.</p>
                    <div className="ui-choice-grid">
                      {resources.map((r) => {
                        const selected = eligible.includes(r.id);
                        return <Button key={r.id} type="button" size="compact" variant={selected ? 'primary' : 'secondary'} aria-pressed={selected} onClick={() => setEligible((prev) => selected ? prev.filter((id) => id !== r.id) : [...prev, r.id])}>{selected ? '✓ ' : ''}{r.name}</Button>;
                      })}
                    </div>
                  </>
                )}
              </fieldset>
            ) : null}
          </div>
          {error ? <InlineNotice tone="danger" title="Couldn’t add this service.">{error}</InlineNotice> : null}
          <Button type="submit" variant="primary" loading={saving} loadingLabel="Adding service…" disabled={!name.trim() || (resourceScope === 'selected' && eligible.length === 0)}>Add service</Button>
        </form>
      ) : null}

      {editing ? <ServiceEditDrawer service={editing} resources={resources} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </div>
  );
}
