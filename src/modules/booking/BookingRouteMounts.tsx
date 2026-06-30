import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import CalendarPage from './vendor/CalendarPage';
import BookingsListPage from './vendor/BookingsListPage';
import ServicesPage from './vendor/ServicesPage';
import ResourcesPage from './vendor/ResourcesPage';
import SettingsPage from './vendor/SettingsPage';

function useAuthBits() {
  const { user, client, permissions, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const perms = useMemo(
    () => new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k)),
    [permissions],
  );
  return { user, client, perms, slug: slug ?? '', loading };
}

function gate(perm: string, render: (slug: string, perms: ReadonlySet<string>) => JSX.Element) {
  return function Mount() {
    const { user, client, perms, slug, loading } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!perms.has(perm)) return <Navigate to={`/c/${slug}`} replace />;
    return render(slug, perms);
  };
}

export const BookingCalendarMount = gate('booking.customers.view', (slug, perms) => <CalendarPage slug={slug} perms={perms} />);
export const BookingListMount = gate('booking.customers.view', (slug, perms) => <BookingsListPage slug={slug} perms={perms} />);
export const BookingServicesMount = gate('booking.employees.view', (slug, perms) => <ServicesPage slug={slug} perms={perms} />);
export const BookingResourcesMount = gate('booking.employees.view', (slug, perms) => <ResourcesPage slug={slug} perms={perms} />);
export const BookingSettingsMount = gate('booking.employees.view', (slug, perms) => <SettingsPage slug={slug} perms={perms} />);
