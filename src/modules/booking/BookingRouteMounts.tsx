import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import './booking.css';
import { useUserAuth } from '../user-portal/user-auth-context';
import CalendarPage from './vendor/CalendarPage';
import BookingsListPage from './vendor/BookingsListPage';
import ServicesPage from './vendor/ServicesPage';
import BookingSetupPage from './vendor/BookingSetupPage';
import BookingPolicyPage from './vendor/BookingPolicyPage';
import SettingsPage from './vendor/SettingsPage';

const ALL_BOOKING_PERMS = [
  'booking.customers.view',
  'booking.customers.create',
  'booking.customers.edit',
  'booking.employees.view',
  'booking.employees.edit',
];

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  // L1 Owner (or legacy null-level) is all-on — consistent with the backend
  // requireBooking bypass and every other gate in the codebase (see POS).
  // We hand them the full booking.* set so internal page gates render too.
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () =>
      isOwner
        ? new Set(ALL_BOOKING_PERMS)
        : new Set(
            Object.entries(permissions)
              .filter(([, v]) => v)
              .map(([k]) => k),
          ),
    [permissions, isOwner],
  );
  const bookingEnabled = enabledModules.some((m) => m.key === 'booking');
  return { user, client, perms, bookingEnabled, slug: slug ?? '', loading };
}

function gate(perm: string, render: (slug: string, perms: ReadonlySet<string>) => JSX.Element) {
  return function Mount() {
    const { user, client, perms, bookingEnabled, slug, loading } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!bookingEnabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has(perm)) return <Navigate to={`/c/${slug}`} replace />;
    return render(slug, perms);
  };
}

export const BookingCalendarMount = gate('booking.customers.view', (slug, perms) => (
  <CalendarPage slug={slug} perms={perms} />
));
export const BookingListMount = gate('booking.customers.view', (slug, perms) => (
  <BookingsListPage slug={slug} perms={perms} />
));
export const BookingServicesMount = gate('booking.employees.view', (slug, perms) => (
  <ServicesPage slug={slug} perms={perms} />
));
export const BookingSetupMount = gate('booking.employees.view', (slug, perms) => (
  <BookingSetupPage slug={slug} perms={perms} />
));
export const BookingPolicyMount = gate('booking.employees.view', (slug, perms) => (
  <BookingPolicyPage slug={slug} perms={perms} />
));
export const BookingResourcesMount = gate('booking.employees.view', (slug) => (
  <Navigate to={`/c/${slug}/booking/setup`} replace />
));
export const BookingSettingsMount = gate('booking.employees.view', (slug, perms) => (
  <SettingsPage slug={slug} perms={perms} />
));
