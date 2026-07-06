import { describe, it, expect } from 'vitest';
import { canViewManufacturing, canEditManufacturing, isOwnerLevel } from '../../src/modules/manufacturing/shared/permissions';

describe('manufacturing FE permissions', () => {
  it('owner (level 1 / null) is all-on', () => {
    expect(isOwnerLevel(1)).toBe(true);
    expect(isOwnerLevel(null)).toBe(true);
    expect(canEditManufacturing({}, 1)).toBe(true);
  });
  it('L2 needs the explicit key', () => {
    expect(canViewManufacturing({}, 2)).toBe(false);
    expect(canViewManufacturing({ 'manufacturing.products.view': true }, 2)).toBe(true);
    expect(canEditManufacturing({ 'manufacturing.products.view': true }, 2)).toBe(false);
  });
});
