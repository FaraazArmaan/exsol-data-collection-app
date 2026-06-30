import { useState, type FormEvent } from 'react';
import { bookingApi, type VendorService, type VendorResource } from '../api';

interface Props {
  services: VendorService[]; resources: VendorResource[];
  defaultResourceId?: string; defaultStart?: string;
  onClose: () => void; onCreated: () => void;
}

export function ManualBookingDrawer({ services, resources, defaultResourceId, defaultStart, onClose, onCreated }: Props) {
  const [blocked, setBlocked] = useState(false);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [resourceId, setResourceId] = useState(defaultResourceId ?? resources[0]?.id ?? '');
  const [start, setStart] = useState(defaultStart ?? '');
  const [end, setEnd] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (blocked) {
        await bookingApi.manualCreate({ blocked: true, resource_id: resourceId, start: new Date(start).toISOString(), end: new Date(end).toISOString() });
      } else {
        await bookingApi.manualCreate({ service_id: serviceId, resource_id: resourceId, start: new Date(start).toISOString(), customer: { name: name.trim(), phone: phone.trim() } });
      }
      onCreated(); onClose();
    } catch (e2: any) { setError(e2?.code ?? 'error'); setBusy(false); }
  }

  return (
    <aside role="dialog" aria-label="New booking" className="pos-drawer booking-drawer">
      <div className="booking-drawer-head">
        <h2 className="section-title">{blocked ? 'Block time' : 'New booking'}</h2>
        <button className="btn btn-ghost" onClick={onClose}>✕</button>
      </div>
      <label className="booking-consent"><input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} /><span>Block staff time (no customer)</span></label>
      <form className="booking-form" onSubmit={submit}>
        <label>Resource<select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>{resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        {!blocked ? <label>Service<select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>{services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.duration_min}m)</option>)}</select></label> : null}
        <label>Start<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
        {blocked ? <label>End<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /></label> : (
          <>
            <label>Customer name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
          </>
        )}
        {error ? <p className="error">Couldn’t create ({error === 'slot_taken' ? 'that slot is taken' : error}).</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : blocked ? 'Block time' : 'Create booking'}</button>
      </form>
    </aside>
  );
}
