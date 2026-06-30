import { describe, it, expect } from 'vitest';
import { derivePermissionRows } from '../../src/modules/registry/products';
import { isValidPermissionKey } from '../../netlify/functions/_shared/permission-keys';

describe('booking permission surfacing', () => {
  it('saloon-booking yields booking.customers + booking.employees rows', () => {
    const rows = derivePermissionRows(['saloon-booking']);
    const buckets = rows.filter((r) => r.module.key === 'booking').map((r) => r.bucket).sort();
    expect(buckets).toEqual(['customers', 'employees']);
  });
  it('booking.customers.view + booking.employees.edit validate when saloon-booking is enabled', () => {
    expect(isValidPermissionKey('booking.customers.view', ['saloon-booking'])).toBe(true);
    expect(isValidPermissionKey('booking.employees.edit', ['saloon-booking'])).toBe(true);
  });
  it('action-namespaced booking keys are rejected (documents the platform gap)', () => {
    expect(isValidPermissionKey('booking.settings.edit', ['saloon-booking'])).toBe(false);
  });
});
