import { NavLink } from 'react-router-dom';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

// Sub-navigation across the booking vendor pages. Calendar/Bookings need
// customers.view; the config tabs need employees.view (settings/services/setup).
export function BookingTabs({ slug, perms }: Props) {
  const canView = perms.has('booking.customers.view');
  const canConfig = perms.has('booking.employees.view') || perms.has('booking.employees.edit');
  return (
    <nav className="booking-tabs" aria-label="Booking sections">
      {canView && (
        <NavLink end to={`/c/${slug}/booking`}>
          Calendar
        </NavLink>
      )}
      {canView && <NavLink to={`/c/${slug}/booking/list`}>Bookings</NavLink>}
      {canConfig && <NavLink to={`/c/${slug}/booking/services`}>Services</NavLink>}
      {canConfig && <NavLink to={`/c/${slug}/booking/setup`}>Booking Setup</NavLink>}
      {canConfig && <NavLink to={`/c/${slug}/booking/policy`}>Booking Rules</NavLink>}
      {canConfig && <NavLink to={`/c/${slug}/booking/settings`}>Settings</NavLink>}
    </nav>
  );
}
