import { describe, expect, it } from 'vitest';
import {
  moduleRegistry, allModules, getModule,
} from '../../src/modules/registry/modules';
import { DATA_BUCKETS, VERBS, PLATFORM_SURFACES } from '../../src/modules/registry/types';
import {
  productRegistry, allProducts, getProduct,
  derivePermissionRows,
} from '../../src/modules/registry/products';
import {
  isValidPermissionKey,
  splitPermissionKey,
} from '../../netlify/functions/_shared/permission-keys';

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

  it('each manifest key matches its registry key (catches copy-paste errors)', () => {
    for (const [registryKey, manifest] of Object.entries(productRegistry)) {
      expect(manifest.key).toBe(registryKey);
    }
  });
});

describe('derivePermissionRows', () => {
  it('returns empty for no enabled products', () => {
    expect(derivePermissionRows([])).toEqual([]);
  });

  it('returns (module, bucket) rows for every enabled product\'s modules', () => {
    const rows = derivePermissionRows(['saloon-booking']);
    // saloon-booking includes Booking (customers + employees) and Payments
    // (customers + products). Only booking + payments are registered today;
    // future Modules (login, rewards, …) will add more rows here.
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

describe('permission keys', () => {
  it('accepts platform keys', () => {
    expect(isValidPermissionKey('_platform.users.view', ['saloon-booking'])).toBe(true);
    expect(isValidPermissionKey('_platform.structure.edit', [])).toBe(true);
    expect(isValidPermissionKey('_platform.settings.delete', [])).toBe(true);
  });

  it('rejects platform keys with unknown surface', () => {
    expect(isValidPermissionKey('_platform.bogus.view', [])).toBe(false);
  });

  it('rejects platform keys with unknown verb', () => {
    expect(isValidPermissionKey('_platform.users.fly', [])).toBe(false);
  });

  it('accepts module keys whose module is enabled via enabled Products', () => {
    expect(isValidPermissionKey('booking.customers.view', ['saloon-booking'])).toBe(true);
    expect(isValidPermissionKey('payments.products.edit', ['saloon-booking'])).toBe(true);
  });

  it('rejects module keys whose module is NOT enabled', () => {
    expect(isValidPermissionKey('booking.customers.view', [])).toBe(false);
  });

  it('rejects module keys whose verb is not declared in the manifest', () => {
    // payments manifest omits 'delete'.
    expect(isValidPermissionKey('payments.customers.delete', ['saloon-booking'])).toBe(false);
  });

  it('rejects module keys whose bucket is not declared in the manifest', () => {
    // booking manifest declares customers + employees, not products.
    expect(isValidPermissionKey('booking.products.view', ['saloon-booking'])).toBe(false);
  });

  it('splits a valid module key', () => {
    expect(splitPermissionKey('booking.customers.view')).toEqual({
      scope: 'module', module: 'booking', bucket: 'customers', verb: 'view',
    });
  });

  it('splits a valid platform key', () => {
    expect(splitPermissionKey('_platform.users.edit')).toEqual({
      scope: 'platform', surface: 'users', verb: 'edit',
    });
  });

  it('returns null for malformed keys', () => {
    expect(splitPermissionKey('nope')).toBeNull();
    expect(splitPermissionKey('a.b')).toBeNull();
    expect(splitPermissionKey('a.b.c.d')).toBeNull();
  });
});

describe('platform surfaces', () => {
  it('includes files surface', () => {
    expect(PLATFORM_SURFACES).toContain('files');
  });

  it('exposes 4 surfaces total (users, structure, settings, files)', () => {
    expect(PLATFORM_SURFACES).toEqual(['users', 'structure', 'settings', 'files']);
  });
});
