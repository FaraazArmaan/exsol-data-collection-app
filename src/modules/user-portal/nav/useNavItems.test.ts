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
  test('L1 (Owner) sees every enabled Module regardless of matrix', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 1,
      enabledModules: enabled,
      permissions: {},
    });
    expect(items.map((i) => i.moduleKey)).toEqual(['booking', 'payments']);
    expect(items[0]).toMatchObject({
      moduleKey: 'booking',
      label: 'Booking & Calendar',
      href: '/c/acme/m/booking',
    });
  });

  test('L2 with view on Booking only sees Booking', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 2,
      enabledModules: enabled,
      permissions: { 'booking.customers.view': true },
    });
    expect(items.map((i) => i.moduleKey)).toEqual(['booking']);
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
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: 1,
      enabledModules: [payments, booking], // pass in reverse
      permissions: {},
    });
    expect(items.map((i) => i.label)).toEqual(['Booking & Calendar', 'Payments']);
  });

  test('null levelNumber treated as L1 (legacy safety)', () => {
    const items = computeNavItems({
      slug: 'acme',
      levelNumber: null,
      enabledModules: enabled,
      permissions: {},
    });
    expect(items.map((i) => i.moduleKey)).toEqual(['booking', 'payments']);
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
