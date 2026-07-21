import { useEffect, useState } from 'react';
import { bookingApi, BookingApiError, type VendorService, type VendorResource } from '../shared/api';
import { formatRupees } from '../format';
import { BookingTabs } from './BookingTabs';
import { ServiceEditDrawer } from './ServiceEditDrawer';
import { Button } from '../../../components/ui/Button';

interface Props { slug: string; perms: ReadonlySet<string>; }

export default function ServicesPage({ slug, perms }: Props) {
  const canEdit = perms.has('booking.employees.edit');
  const [services, setServices] = useState<VendorService[] | null>(null);
  const [resources, setResources] = useState<VendorResource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<VendorService | 'new' | null>(null);

  function reload() { bookingApi.listServices().then((r) => setServices(r.services)).catch(() => setError('load_error')); }
  useEffect(() => { reload(); bookingApi.listResources().then((r) => setResources(r.resources)).catch(() => {}); }, []);

  async function remove(id: string) { await bookingApi.deleteService(id); reload(); }

  if (error === 'load_error') return <p className="error">Couldn’t load services.</p>;
  if (!services) return <div className="muted">Loading…</div>;

  return (
    <div className="page page-standard booking-vendor">
      <BookingTabs slug={slug} perms={perms} />
      <div className="booking-services-head">
        <h1 className="page-title">Services</h1>
        {canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>+ Add service</Button> : null}
      </div>

      <div className="booking-mobile-service-list" aria-label="Services">
        {services.map((service) => (
          <article key={service.id} className="booking-mobile-service-card">
            <div>
              <h2>{service.name}</h2>
              <p>{service.duration_min} min · {formatRupees(service.price_cents)}</p>
              <p>{service.payment_mode.replaceAll('_', ' ')}</p>
            </div>
            {canEdit ? <Button size="compact" variant="secondary" onClick={() => setEditing(service)}>Edit</Button> : null}
          </article>
        ))}
        {services.length === 0 ? <p className="muted">No services yet.</p> : null}
      </div>

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

      {editing ? <ServiceEditDrawer service={editing === 'new' ? undefined : editing} resources={resources} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </div>
  );
}
