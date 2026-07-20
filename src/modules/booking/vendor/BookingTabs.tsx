import { NavLink, useLocation } from 'react-router-dom';
import { SectionSwitcher } from '../../../components/ui/SectionSwitcher';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

// Sub-navigation across the booking vendor pages. Calendar/Bookings need
// customers.view; the config tabs need employees.view (settings/services/setup).
export function BookingTabs({ slug, perms }: Props) {
  const canView = perms.has('booking.customers.view');
  const canConfig = perms.has('booking.employees.view') || perms.has('booking.employees.edit');
  const { pathname } = useLocation();
  const items = [
    ...(canView ? [{ label: 'Calendar', to: `/c/${slug}/booking`, end: true }, { label: 'Bookings', to: `/c/${slug}/booking/list` }] : []),
    ...(canConfig ? [
      { label: 'Services', to: `/c/${slug}/booking/services` },
      { label: 'Booking Setup', to: `/c/${slug}/booking/setup` },
      { label: 'Booking Rules', to: `/c/${slug}/booking/policy` },
      { label: 'Settings', to: `/c/${slug}/booking/settings` },
    ] : []),
  ];
  const activeLabel = items.find((item) => pathname === item.to)?.label ?? 'Booking';
  return (
    <>
      <nav className="booking-tabs ui-section-tabs" aria-label="Booking sections">
        {items.map((item) => <NavLink key={item.to} end={item.end} to={item.to}>{item.label}</NavLink>)}
      </nav>
      <SectionSwitcher label="Booking sections" activeLabel={activeLabel}>
        <nav aria-label="Booking sections">
          {items.map((item) => <NavLink key={item.to} end={item.end} to={item.to}>{item.label}</NavLink>)}
        </nav>
      </SectionSwitcher>
    </>
  );
}
