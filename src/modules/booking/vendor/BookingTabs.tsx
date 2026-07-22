import { NavLink, useLocation } from 'react-router-dom';
import { SectionSwitcher } from '../../../components/ui/SectionSwitcher';
import { WorkspaceLayoutControl, orderedWorkspaceItems, useWorkspaceLayout } from '../../../components/ui/WorkspaceLayout';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

// Sub-navigation across the booking vendor pages. Calendar/Bookings need
// customers.view; the config tabs need employees.view (settings/services/setup).
export function BookingTabs({ slug, perms }: Props) {
  const workspaceLayout = useWorkspaceLayout({
    namespace: 'booking.tabs',
    tabs: [
      { id: 'calendar', label: 'Calendar' }, { id: 'bookings', label: 'Bookings' }, { id: 'services', label: 'Services' },
      { id: 'setup', label: 'Booking Setup' }, { id: 'rules', label: 'Booking Rules' }, { id: 'settings', label: 'Settings' },
    ],
  });
  const canView = perms.has('booking.customers.view');
  const canConfig = perms.has('booking.employees.view') || perms.has('booking.employees.edit');
  const { pathname } = useLocation();
  const items = [
    ...(canView ? [{ id: 'calendar', label: 'Calendar', to: `/c/${slug}/booking`, end: true }, { id: 'bookings', label: 'Bookings', to: `/c/${slug}/booking/list` }] : []),
    ...(canConfig ? [
      { id: 'services', label: 'Services', to: `/c/${slug}/booking/services` },
      { id: 'setup', label: 'Booking Setup', to: `/c/${slug}/booking/setup` },
      { id: 'rules', label: 'Booking Rules', to: `/c/${slug}/booking/policy` },
      { id: 'settings', label: 'Settings', to: `/c/${slug}/booking/settings` },
    ] : []),
  ];
  const orderedItems = orderedWorkspaceItems(items, workspaceLayout.effective.tabs);
  const activeLabel = orderedItems.find((item) => pathname === item.to)?.label ?? 'Booking';
  return (
    <>
      <div className="booking-tabs-toolbar">
        <nav className="booking-tabs ui-section-tabs" aria-label="Booking sections">
          {orderedItems.map((item) => <NavLink key={item.to} end={item.end} to={item.to}>{item.label}</NavLink>)}
        </nav>
        <WorkspaceLayoutControl definition={{ namespace: 'booking.tabs', tabs: [
          { id: 'calendar', label: 'Calendar' }, { id: 'bookings', label: 'Bookings' }, { id: 'services', label: 'Services' },
          { id: 'setup', label: 'Booking Setup' }, { id: 'rules', label: 'Booking Rules' }, { id: 'settings', label: 'Settings' },
        ] }} layout={workspaceLayout} label="Arrange tabs" />
      </div>
      <SectionSwitcher label="Booking sections" activeLabel={activeLabel}>
        <nav aria-label="Booking sections">
          {orderedItems.map((item) => <NavLink key={item.to} end={item.end} to={item.to}>{item.label}</NavLink>)}
        </nav>
      </SectionSwitcher>
    </>
  );
}
