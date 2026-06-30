import { useEffect, useState, type FormEvent } from 'react';
import { bookingApi, BookingApiError, type VendorResource, type TimeOff } from '../api';

interface Props { slug: string; perms: ReadonlySet<string>; }

export default function ResourcesPage({ perms }: Props) {
  const canEdit = perms.has('booking.employees.edit');
  const [resources, setResources] = useState<VendorResource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string>('');
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [toStart, setToStart] = useState('');
  const [toEnd, setToEnd] = useState('');

  function reload() { bookingApi.listResources().then((r) => setResources(r.resources)).catch(() => setError('load_error')); }
  useEffect(() => { reload(); }, []);
  useEffect(() => { if (selected) bookingApi.listTimeOff(selected).then((r) => setTimeOff(r.time_off)).catch(() => setTimeOff([])); }, [selected]);

  async function addResource(e: FormEvent) {
    e.preventDefault();
    try { await bookingApi.createResource({ name: name.trim() }); setName(''); reload(); }
    catch (e2) { setError(e2 instanceof BookingApiError ? e2.code : 'save_error'); }
  }
  async function addTimeOff(e: FormEvent) {
    e.preventDefault();
    if (!selected || !toStart || !toEnd) return;
    await bookingApi.addTimeOff({ resource_id: selected, starts_at: new Date(toStart).toISOString(), ends_at: new Date(toEnd).toISOString() });
    setToStart(''); setToEnd('');
    bookingApi.listTimeOff(selected).then((r) => setTimeOff(r.time_off));
  }

  if (error === 'load_error') return <p className="error">Couldn’t load resources.</p>;
  if (!resources) return <div className="muted">Loading…</div>;

  return (
    <div className="page booking-vendor">
      <h1 className="page-title">Resources</h1>

      <table className="booking-table">
        <thead><tr><th>Name</th><th>Status</th>{canEdit ? <th></th> : null}</tr></thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r.id} className={selected === r.id ? 'booking-row-selected' : ''} onClick={() => setSelected(r.id)} style={{ cursor: 'pointer' }}>
              <td>{r.name}</td><td>{r.active ? 'active' : 'inactive'}</td>
              {canEdit ? <td><button className="btn btn-ghost btn-danger" onClick={(e) => { e.stopPropagation(); bookingApi.deleteResource(r.id).then(reload); }}>Deactivate</button></td> : null}
            </tr>
          ))}
          {resources.length === 0 ? <tr><td colSpan={3} className="muted">No resources yet.</td></tr> : null}
        </tbody>
      </table>

      {canEdit ? (
        <form className="card booking-form" onSubmit={addResource}>
          <h2 className="section-title">Add a resource</h2>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah / Room 1" required /></label>
          <button className="btn btn-primary" type="submit" disabled={!name.trim()}>Add resource</button>
        </form>
      ) : null}

      {selected ? (
        <div className="card">
          <h2 className="section-title">Time off · {resources.find((r) => r.id === selected)?.name}</h2>
          <ul className="booking-list-plain">
            {timeOff.map((t) => (
              <li key={t.id}>
                {new Date(t.starts_at).toLocaleString()} → {new Date(t.ends_at).toLocaleString()}
                {canEdit ? <button className="btn btn-ghost" onClick={() => bookingApi.deleteTimeOff(t.id).then(() => bookingApi.listTimeOff(selected).then((r) => setTimeOff(r.time_off)))}>Remove</button> : null}
              </li>
            ))}
            {timeOff.length === 0 ? <li className="muted">No time off.</li> : null}
          </ul>
          {canEdit ? (
            <form className="booking-form-inline" onSubmit={addTimeOff}>
              <input type="datetime-local" value={toStart} onChange={(e) => setToStart(e.target.value)} />
              <input type="datetime-local" value={toEnd} onChange={(e) => setToEnd(e.target.value)} />
              <button className="btn btn-secondary" type="submit">Add time off</button>
            </form>
          ) : null}
        </div>
      ) : <p className="muted">Select a resource to manage its time off.</p>}
    </div>
  );
}
