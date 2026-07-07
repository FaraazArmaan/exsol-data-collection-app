// Booking authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';

const ALL_BOOKING_PERMS = [
  'booking.customers.view', 'booking.customers.create', 'booking.customers.edit',
  'booking.employees.view', 'booking.employees.edit',
] as const;

export type BookingAuthCtx = ModuleAuthCtx;

export const requireBooking = makeModuleAuthz({
  moduleKeys: ['booking'],
  notEnabledCode: 'booking_module_not_enabled',
  allPerms: ALL_BOOKING_PERMS,
});
