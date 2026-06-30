import { describe, expect, test } from 'vitest';
import { computeNavItems } from './useNavItems';
import type {
  UserPortalEnabledModule, UserPortalPermissionMatrix,
} from '../api';

// Real Module shapes from src/modules/registry/manifests/.
// Booking & Calendar has buckets { customers, employees }; Payments has { customers, products }.
// Verbs are { view, create, edit, delete } (payments has no delete).
const booking: UserPortalEnabledModule = { key: 'booking', label: 'Booking & Calendar' };
const payments: UserPortalEnabledModule = { key: 'payments', label: 'Payments' };
const enabled = [booking, payments];

describe('computeNavItems', () => {
  test('L1 (Owner) sees every enabled rail Module regardless of matrix', () => {
    // Note: booking now has a dedicated sidebar entry (like products + pos), so it
    // is excluded from the generic Modules rail. Only `payments` surfaces in this rail
    // for this fixture; the booking link is rendered separately by Sidebar.tsx.
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 1,
      enabledModules: enabled,
      permissions: {},
    });
    expect(items.map((i) => i.moduleKey)).toEqual(['payments']);
    expect(items[0]).toMatchObject({
      moduleKey: 'payments',
      label: 'Payments',
      href: '/c/acme/m/payments',
    });
  });

  test('L2 with view on Booking does NOT surface in generic rail (dedicated entry instead)', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 2,
      enabledModules: enabled,
      permissions: { 'booking.customers.view': true },
    });
    // booking is excluded from the rail; the Sidebar renders its dedicated link gated
    // on the same booking.customers.view / booking.employees.view permissions.
    expect(items.map((i) => i.moduleKey)).toEqual([]);
  });

  test('L2 with no view verbs sees nothing', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 3,
      enabledModules: enabled,
      // 'create' alone does not surface a Module in nav — read access (view) is required.
      permissions: { 'booking.customers.create': true },
    });
    expect(items).toEqual([]);
  });

  test('Module enabled on client but absent from permissions is excluded for L2+', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 2,
      enabledModules: enabled,
      permissions: { 'payments.customers.view': true },
    });
    expect(items.map((i) => i.moduleKey)).toEqual(['payments']);
  });

  test('alphabetical ordering by label', () => {
    // Add a second rail module so we can observe ordering (booking is dedicated, not in rail).
    const finance: UserPortalEnabledModule = { key: 'finance', label: 'Finance' };
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 1,
      enabledModules: [payments, finance, booking], // pass in mixed order
      permissions: {},
    });
    // Only non-dedicated modules surface; sorted by label.
    expect(items.map((i) => i.label)).toEqual(['Finance', 'Payments']);
  });

  test('null levelNumber treated as L1 (legacy safety)', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: null,
      enabledModules: enabled,
      permissions: {},
    });
    // booking excluded (dedicated entry); payments surfaces in rail.
    expect(items.map((i) => i.moduleKey)).toEqual(['payments']);
  });

  test('products + pos + booking are excluded from generic rail (each has dedicated sidebar entry)', () => {
    const products: UserPortalEnabledModule = { key: 'products', label: 'Product Manager' };
    const pos: UserPortalEnabledModule = { key: 'pos', label: 'POS' };
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 1,
      enabledModules: [booking, products, pos, payments],
      permissions: {},
    });
    expect(items.map((i) => i.moduleKey)).toEqual(['payments']);
  });

  test('platform keys (_platform.*) are ignored — they do not surface a Module', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 2,
      enabledModules: enabled,
      permissions: { '_platform.users.view': true, '_platform.settings.view': true },
    });
    expect(items).toEqual([]);
  });
});
