import { describe, expect, test } from 'vitest';
import {
  CATEGORY_KEYS,
  CATEGORY_LABELS,
  isCategoryKey,
  type CategoryKey,
} from '../../src/modules/files/shared/categories';

describe('file categories', () => {
  test('has exactly 11 category keys', () => {
    expect(CATEGORY_KEYS).toHaveLength(11);
  });

  test('every key has a non-empty label', () => {
    for (const k of CATEGORY_KEYS) {
      expect(CATEGORY_LABELS[k]).toBeTruthy();
    }
  });

  test('isCategoryKey accepts known keys', () => {
    expect(isCategoryKey('finance_accounting')).toBe(true);
    expect(isCategoryKey('hr_payroll')).toBe(true);
  });

  test('isCategoryKey rejects unknown keys', () => {
    expect(isCategoryKey('garbage')).toBe(false);
    expect(isCategoryKey('')).toBe(false);
  });

  test('CategoryKey type narrows', () => {
    const k: string = 'finance_accounting';
    if (isCategoryKey(k)) {
      const _narrowed: CategoryKey = k; // compile-time check
      expect(_narrowed).toBe('finance_accounting');
    }
  });
});
