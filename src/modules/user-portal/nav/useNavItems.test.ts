import { describe, expect, test } from 'vitest';
import { computeNavItems } from './useNavItems';
import type { UserPortalEnabledModule } from '../api';

// Real Module shapes from src/modules/registry/manifests/.
// Booking & Calendar has buckets { customers, employees }; Payments has { customers, products }.
// Verbs are { view, create, edit, delete } (payments has no delete).
const booking: UserPortalEnabledModule = { key: 'booking', label: 'Booking & Calendar' };
const payments: UserPortalEnabledModule = { key: 'payments', label: 'Payments' };
const enabled = [booking, payments];

describe('computeNavItems', () => {
  test('L1 (Owner) excludes every enabled dedicated-nav Module from the generic rail', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 1,
      enabledModules: enabled,
      permissions: {},
    });
    expect(items).toEqual([]);
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

  test('L2 with view on Payments does NOT surface in generic rail (dedicated entry instead)', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 2,
      enabledModules: enabled,
      permissions: { 'payments.customers.view': true },
    });
    expect(items).toEqual([]);
  });

  test('alphabetical ordering by label', () => {
    // Two generic (non-dedicated) rail modules to observe ordering. Synthetic
    // keys so the test stays valid as real modules gain dedicated sidebar
    // entries (finance is now dedicated, like booking/pos/analytics).
    const zebra: UserPortalEnabledModule = { key: 'zebra-mod', label: 'Zebra' };
    const apple: UserPortalEnabledModule = { key: 'apple-mod', label: 'Apple' };
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 1,
      enabledModules: [zebra, apple, booking], // pass in non-sorted order
      permissions: {},
    });
    // Only non-dedicated modules surface; sorted by label (booking is dedicated).
    expect(items.map((i) => i.label)).toEqual(['Apple', 'Zebra']);
  });

  test('null levelNumber treated as L1 (legacy safety)', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: null,
      enabledModules: enabled,
      permissions: {},
    });
    expect(items).toEqual([]);
  });

  test('products, pos, booking, and payments are excluded from generic rail', () => {
    const products: UserPortalEnabledModule = { key: 'products', label: 'Product Manager' };
    const pos: UserPortalEnabledModule = { key: 'pos', label: 'POS' };
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 1,
      enabledModules: [booking, products, pos, payments],
      permissions: {},
    });
    expect(items).toEqual([]);
  });

  test('analytics is excluded from the generic rail (it has a dedicated sidebar entry)', () => {
    const analytics: UserPortalEnabledModule = { key: 'analytics', label: 'Analytics' };
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 1,
      enabledModules: [analytics, payments],
      permissions: {},
    });
    expect(items.find((i) => i.moduleKey === 'analytics')).toBeUndefined();
    expect(items).toEqual([]);
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
