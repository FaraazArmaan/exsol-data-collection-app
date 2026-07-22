import { useEffect, useState } from 'react';
import { bookingApi, type VendorService, type VendorResource } from '../shared/api';
import { formatRupees } from '../format';
import { BookingTabs } from './BookingTabs';
import { ServiceEditDrawer } from './ServiceEditDrawer';
import { Button } from '../../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../../components/ui/Feedback';

interface Props { slug: string; perms: ReadonlySet<string>; }

export default function ServicesPage({ slug, perms }: Props) {
  const canEdit = perms.has('booking.employees.edit');
  const [services, setServices] = useState<VendorService[] | null>(null);
  const [resources, setResources] = useState<VendorResource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<VendorService | 'new' | null>(null);

  function reload() {
    setError(null);
    setServices(null);
    bookingApi.listServices().then((r) => setServices(r.services)).catch(() => setError('load_error'));
  }
  useEffect(() => { reload(); bookingApi.listResources().then((r) => setResources(r.resources)).catch(() => {}); }, []);

  async function remove(id: string) { await bookingApi.deleteService(id); reload(); }

  return (
    <div className="page page-standard booking-vendor">
      <BookingTabs slug={slug} perms={perms} />
      <div className="booking-services-head">
        <h1 className="page-title">Services</h1>
        {canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>+ Add service</Button> : null}
      </div>

      {error === 'load_error' ? <ErrorState title="Couldn’t load services." action={<Button size="compact" onClick={reload}>Try again</Button>} /> : null}
      {!services && !error ? <LoadingState title="Loading services…" /> : null}
      {services?.length === 0 ? <EmptyState title="No services yet." action={canEdit ? <Button size="compact" variant="primary" onClick={() => setEditing('new')}>Add service</Button> : undefined} /> : null}
      {services && services.length > 0 ? <><div className="booking-mobile-service-list" aria-label="Services">
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
        </tbody>
      </table>
      </> : null}

      {editing ? <ServiceEditDrawer service={editing === 'new' ? undefined : editing} resources={resources} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </div>
  );
}
