import { describe, expect, it } from 'vitest';
import {
  moduleRegistry, allModules, getModule,
} from '../../src/modules/registry/modules';
import { DATA_BUCKETS, VERBS } from '../../src/modules/registry/types';

describe('module registry', () => {
  it('contains booking and payments modules', () => {
    expect(getModule('booking')).toBeDefined();
    expect(getModule('payments')).toBeDefined();
  });

  it('every registered Module has a valid manifest shape', () => {
    for (const m of allModules()) {
      expect(typeof m.key).toBe('string');
      expect(typeof m.label).toBe('string');
      expect(Array.isArray(m.data_buckets)).toBe(true);
      for (const b of m.data_buckets) expect(DATA_BUCKETS).toContain(b);
      for (const v of m.verbs) expect(VERBS).toContain(v);
      expect(typeof m.vendor_side).toBe('boolean');
      expect(typeof m.customer_side).toBe('boolean');
    }
  });

  it('module keys are unique', () => {
    const keys = allModules().map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('each manifest key matches its registry key (catches copy-paste errors)', () => {
    for (const [registryKey, manifest] of Object.entries(moduleRegistry)) {
      expect(manifest.key).toBe(registryKey);
    }
  });

  it('getModule returns undefined for unknown key', () => {
    expect(getModule('nonexistent-module')).toBeUndefined();
  });

  it('registry is exported as an object keyed by ModuleKey', () => {
    expect(moduleRegistry.booking?.key).toBe('booking');
    expect(moduleRegistry.payments?.key).toBe('payments');
  });
});

import {
  productRegistry, allProducts, getProduct,
  derivePermissionRows,
} from '../../src/modules/registry/products';

describe('product registry', () => {
  it('saloon-booking product exists and references real modules', () => {
    const p = getProduct('saloon-booking');
    expect(p).toBeDefined();
    for (const ref of p!.modules) {
      expect(getModule(ref.module)).toBeDefined();
    }
  });

  it('product keys are unique', () => {
    const keys = allProducts().map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('derivePermissionRows', () => {
  it('returns empty for no enabled products', () => {
    expect(derivePermissionRows([])).toEqual([]);
  });

  it('returns (module, bucket) rows for every enabled product\'s modules', () => {
    const rows = derivePermissionRows(['saloon-booking']);
    // saloon-booking includes Booking (customers + employees) and Payments
    // (customers + products). Login is bucket-less and contributes no rows.
    const keys = rows.map((r) => `${r.module.key}.${r.bucket}`).sort();
    expect(keys).toEqual([
      'booking.customers',
      'booking.employees',
      'payments.customers',
      'payments.products',
    ]);
  });

  it('deduplicates rows when two products use the same module', () => {
    const rows = derivePermissionRows(['saloon-booking', 'saloon-booking']);
    const keys = rows.map((r) => `${r.module.key}.${r.bucket}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
