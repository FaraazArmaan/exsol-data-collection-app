import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { bookingApi, type VendorService, type VendorResource } from '../shared/api';
import { DateField, TimeField } from '../../../components/ui/DateTimeField';

interface Props {
  services: VendorService[]; resources: VendorResource[];
  defaultResourceId?: string; defaultStart?: string;
  onClose: () => void; onCreated: () => void;
}

export function ManualBookingDrawer({ services, resources, defaultResourceId, defaultStart, onClose, onCreated }: Props) {
  const [blocked, setBlocked] = useState(false);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [resourceId, setResourceId] = useState(defaultResourceId ?? resources[0]?.id ?? '');
  const [startDate, setStartDate] = useState(defaultStart?.split('T')[0] ?? '');
  const [startTime, setStartTime] = useState(defaultStart?.split('T')[1] ?? '');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bookingResources = useMemo(() => {
    if (blocked) return resources;
    const eligible = services.find((service) => service.id === serviceId)?.eligible_resource_ids ?? [];
    return eligible.length ? resources.filter((resource) => eligible.includes(resource.id)) : resources;
  }, [blocked, resources, serviceId, services]);

  useEffect(() => {
    if (!bookingResources.some((resource) => resource.id === resourceId)) {
      setResourceId(bookingResources[0]?.id ?? '');
    }
  }, [bookingResources, resourceId]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const start = startDate && startTime ? `${startDate}T${startTime}` : '';
    const end = endDate && endTime ? `${endDate}T${endTime}` : '';
    if (!start || (blocked && !end)) {
      setError('date_time_required'); setBusy(false); return;
    }
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
        <label>Resource<select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>{bookingResources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        {!blocked ? <label>Service<select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>{services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.duration_min}m)</option>)}</select></label> : null}
        <div className="booking-date-time-fields">
          <DateField label="Start date" value={startDate} onChange={setStartDate} required />
          <TimeField label="Start time" value={startTime} onChange={setStartTime} required stepMinutes={15} />
        </div>
        {blocked ? <div className="booking-date-time-fields">
          <DateField label="End date" value={endDate} onChange={setEndDate} required />
          <TimeField label="End time" value={endTime} onChange={setEndTime} required stepMinutes={15} />
        </div> : (
          <>
            <label>Customer name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
          </>
        )}
        {error ? <p className="error">{error === 'date_time_required' ? 'Choose a date and time.' : `Couldn’t create (${error === 'slot_taken' ? 'that slot is taken' : error}).`}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy || !resourceId}>{busy ? 'Saving…' : blocked ? 'Block time' : 'Create booking'}</button>
      </form>
    </aside>
  );
}
