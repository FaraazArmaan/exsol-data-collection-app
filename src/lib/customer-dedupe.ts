// Phone normalization + customer dedupe key. Phone is the primary person-key;
// email is the tiebreaker (see booking spec §1 dedupe default).
//
// Lives in src/lib because it is a cross-seam helper: consumed by the booking
// customer upsert (_booking-customer-upsert.ts), the CRM merge engine
// (crm/lib/merge.ts), and the public CRM lead path (_crm-public.ts).

export function normalizePhone(raw: string, defaultCountry: '+91' = '+91'): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/[^\d]/g, '');
  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, ''); // national-format leading zero
  if (digits.length === 10) return `${defaultCountry}${digits}`;   // bare local → assume default country
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function dedupeKey(phone: string | null, email: string | null): string {
  const e = (email ?? '').trim().toLowerCase();
  return `${phone ?? ''}|${e}`;
}
