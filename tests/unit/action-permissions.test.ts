// Phase 2 — granular action-namespace grants for non-Owner levels.
// The registry helpers expose a product's declared action permissions so the
// admin dashboard can render per-action toggles and the PUT validator can
// accept them. POS is the only action-namespace product today, but the helpers
// are product-agnostic.

import { describe, it, expect } from 'vitest';
import { actionPermissionGroups, actionPermissionKeys } from '../../src/modules/registry/products';
import { isValidPermissionKey } from '../../netlify/functions/_shared/permission-keys';
import { POS_ACTIONS } from '../../src/modules/registry/types';

describe('actionPermissionGroups', () => {
  it('returns the POS group with all 8 actions when pos is enabled', () => {
    const groups = actionPermissionGroups(['products', 'pos']);
    const pos = groups.find((g) => g.product_key === 'pos');
    expect(pos).toBeTruthy();
    expect(pos!.label).toBe('POS');
    expect(pos!.actions.map((a) => a.key).sort()).toEqual(
      POS_ACTIONS.map((a) => `pos.${a}`).sort(),
    );
    expect(pos!.actions.every((a) => typeof a.label === 'string' && a.label.length > 0)).toBe(true);
  });

  it('omits products without a declared permissions list', () => {
    // 'products' product has no action-namespace permissions.
    expect(actionPermissionGroups(['products'])).toEqual([]);
  });

  it('returns [] for no enabled products / unknown keys', () => {
    expect(actionPermissionGroups([])).toEqual([]);
    expect(actionPermissionGroups(['nope'])).toEqual([]);
  });
});

describe('actionPermissionKeys', () => {
  it('is the flat set of pos.* keys when pos is enabled', () => {
    const keys = actionPermissionKeys(['products', 'pos']);
    expect(keys.has('pos.menu.view')).toBe(true);
    expect(keys.has('pos.sale.markPaid')).toBe(true);
    expect(keys.size).toBe(POS_ACTIONS.length);
  });

  it('is empty when pos is not enabled', () => {
    expect(actionPermissionKeys(['products']).size).toBe(0);
  });
});

describe('isValidPermissionKey — action namespace', () => {
  it('accepts pos.* keys when pos is enabled', () => {
    expect(isValidPermissionKey('pos.menu.view', ['products', 'pos'])).toBe(true);
    expect(isValidPermissionKey('pos.sale.markPaid', ['products', 'pos'])).toBe(true);
    expect(isValidPermissionKey('pos.history.viewAll', ['products', 'pos'])).toBe(true);
  });

  it('rejects pos.* keys when pos is NOT enabled', () => {
    expect(isValidPermissionKey('pos.menu.view', ['products'])).toBe(false);
  });

  it('rejects an unknown pos action even when pos is enabled', () => {
    expect(isValidPermissionKey('pos.sale.bogus', ['products', 'pos'])).toBe(false);
  });

  it('still accepts module + platform keys (regression)', () => {
    expect(isValidPermissionKey('products.products.view', ['products'])).toBe(true);
    expect(isValidPermissionKey('_platform.users.view', [])).toBe(true);
    expect(isValidPermissionKey('_platform.bogus.view', [])).toBe(false);
  });
});
