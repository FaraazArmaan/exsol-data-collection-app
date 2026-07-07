import { normalizePhone } from '../../../lib/customer-dedupe';

export type CrmSource = 'pos' | 'storefront' | 'booking';

export interface RawCustomerRow {
  display_name: string | null;
  phone: string | null;
  email: string | null;
  source: CrmSource;
  first_seen: string; // ISO timestamp
  last_seen: string;
}

export interface MergedCustomer {
  display_name: string;
  phone: string | null;
  email: string | null;
  dedupe_key: string;
  source: CrmSource;
  first_seen: string;
  last_seen: string;
}

const ms = (iso: string) => new Date(iso).getTime();

/**
 * Canonical identity key: phone when present (primary person-key), else email
 * (tiebreaker). Deterministic per person → the emitted dedupe_key is stable
 * across refreshes, which the DB upsert (ON CONFLICT client_id, dedupe_key)
 * relies on for stable crm_customers ids and note FKs.
 */
function identityKey(phone: string | null, email: string | null): string | null {
  if (phone) return `phone:${phone}`;
  if (email) return `email:${email}`;
  return null;
}

export function mergeCustomers(rows: RawCustomerRow[]): MergedCustomer[] {
  const byKey = new Map<string, MergedCustomer>();
  for (const r of rows) {
    const phone = normalizePhone(r.phone ?? '');
    const email = r.email ? r.email.trim().toLowerCase() : null;
    const key = identityKey(phone, email);
    if (!key) continue; // no usable identity (no phone AND no email)
    const name = (r.display_name ?? '').trim();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        display_name: name || 'Unknown',
        phone: phone ?? null,
        email,
        dedupe_key: key,
        source: r.source,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
      });
      continue;
    }
    if (ms(r.first_seen) < ms(existing.first_seen)) {
      existing.first_seen = r.first_seen;
      existing.source = r.source; // origin follows the earliest sighting
    }
    if (ms(r.last_seen) > ms(existing.last_seen)) existing.last_seen = r.last_seen;
    if ((!existing.display_name || existing.display_name === 'Unknown') && name) existing.display_name = name;
    if (!existing.phone && phone) existing.phone = phone;
    if (!existing.email && email) existing.email = email;
  }
  return [...byKey.values()];
}
