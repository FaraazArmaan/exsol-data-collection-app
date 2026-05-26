import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../netlify/functions/_shared/argon';

describe('argon', () => {
  it('hash + verify round-trip', async () => {
    const h = await hashPassword('hunter2');
    expect(await verifyPassword('hunter2', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
  it('returns false for null hash (constant-time dummy verify)', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
  });
});
