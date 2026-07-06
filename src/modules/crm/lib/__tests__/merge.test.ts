import { describe, it, expect } from 'vitest';
import { mergeCustomers, type RawCustomerRow } from '../merge';

const row = (o: Partial<RawCustomerRow>): RawCustomerRow => ({
  display_name: 'X', phone: null, email: null, source: 'pos',
  first_seen: '2026-01-01T00:00:00.000Z', last_seen: '2026-01-01T00:00:00.000Z', ...o,
});

describe('mergeCustomers', () => {
  it('dedupes the same person seen via POS and booking into one row', () => {
    const out = mergeCustomers([
      row({ display_name: 'Aisha', phone: '9876543210', email: 'a@x.com', source: 'pos', first_seen: '2026-02-01T00:00:00.000Z', last_seen: '2026-02-01T00:00:00.000Z' }),
      row({ display_name: 'Aisha Khan', phone: '+919876543210', email: 'A@X.com', source: 'booking', first_seen: '2026-01-15T00:00:00.000Z', last_seen: '2026-03-01T00:00:00.000Z' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.first_seen).toBe('2026-01-15T00:00:00.000Z'); // earliest
    expect(out[0]!.last_seen).toBe('2026-03-01T00:00:00.000Z');  // latest
    expect(out[0]!.source).toBe('booking');                       // source of the earliest sighting
  });

  it('keeps distinct people separate', () => {
    const out = mergeCustomers([
      row({ phone: '9876543210', email: 'a@x.com' }),
      row({ phone: '9999999999', email: 'b@x.com' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('skips rows with neither phone nor email', () => {
    const out = mergeCustomers([row({ phone: null, email: null, display_name: 'Ghost' })]);
    expect(out).toHaveLength(0);
  });

  it('prefers a non-empty display name and back-fills missing contact fields', () => {
    const out = mergeCustomers([
      row({ display_name: '', phone: '9876543210', email: null, source: 'pos' }),
      row({ display_name: 'Real Name', phone: '9876543210', email: 'r@x.com', source: 'booking', last_seen: '2026-05-01T00:00:00.000Z' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.display_name).toBe('Real Name');
    expect(out[0]!.email).toBe('r@x.com');
  });

  it('emits a stable, order-independent dedupe_key for the same phone (DB upsert relies on this)', () => {
    const a = row({ phone: '9876543210', email: 'a@x.com', first_seen: '2026-02-01T00:00:00.000Z', last_seen: '2026-02-01T00:00:00.000Z' });
    const b = row({ phone: '+919876543210', email: 'b@x.com', first_seen: '2026-01-01T00:00:00.000Z', last_seen: '2026-03-01T00:00:00.000Z' });
    const forward = mergeCustomers([a, b]);
    const reverse = mergeCustomers([b, a]);
    expect(forward).toHaveLength(1);
    expect(reverse).toHaveLength(1);
    expect(forward[0]!.dedupe_key).toBe(reverse[0]!.dedupe_key); // key does not depend on row order or email
  });

  it('falls back to email as the key when there is no phone, and merges two email-only rows', () => {
    const out = mergeCustomers([
      row({ phone: null, email: 'only@x.com', display_name: 'A' }),
      row({ phone: null, email: 'ONLY@x.com', display_name: 'B', last_seen: '2026-06-01T00:00:00.000Z' }),
    ]);
    expect(out).toHaveLength(1);
  });
});
