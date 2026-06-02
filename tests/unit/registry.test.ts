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

  it('getModule returns undefined for unknown key', () => {
    expect(getModule('nonexistent-module')).toBeUndefined();
  });

  it('registry is exported as an object keyed by ModuleKey', () => {
    expect(moduleRegistry.booking?.key).toBe('booking');
    expect(moduleRegistry.payments?.key).toBe('payments');
  });
});
