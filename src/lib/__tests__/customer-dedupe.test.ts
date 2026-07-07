import { describe, it, expect } from 'vitest';
import { normalizePhone, dedupeKey } from '../customer-dedupe';

describe('normalizePhone', () => {
  it('formats a bare Indian 10-digit number to +91', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
  });
  it('keeps an existing +country prefix', () => {
    expect(normalizePhone('+1 (415) 555-2671')).toBe('+14155552671');
  });
  it('treats 0-prefixed local numbers as national (drops the 0)', () => {
    expect(normalizePhone('098765 43210')).toBe('+919876543210');
  });
  it('returns null for junk', () => {
    expect(normalizePhone('call me')).toBeNull();
  });
});

describe('dedupeKey', () => {
  it('lowercases email and pairs with normalized phone', () => {
    expect(dedupeKey('+919876543210', '  Riya@Example.COM ')).toBe('+919876543210|riya@example.com');
  });
  it('tolerates a missing email', () => {
    expect(dedupeKey('+919876543210', null)).toBe('+919876543210|');
  });
});
