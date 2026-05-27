const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(s: string): boolean {
  return typeof s === 'string' && UUID_RE.test(s);
}

export function assertUuid(s: string, field?: string): void {
  if (!isValidUuid(s)) {
    throw new Error(field ? `invalid_uuid:${field}` : 'invalid_uuid');
  }
}

const SLUG_FORMAT = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

function defaultHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function deriveSlug(name: string, rand: () => string = defaultHex): string {
  let s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/-+$/g, '');
  if (s.length < 2 || !SLUG_FORMAT.test(s)) {
    s = `c-${rand().slice(0, 8)}`;
  }
  return s;
}

export function isValidSlug(s: string): boolean {
  return typeof s === 'string' && SLUG_FORMAT.test(s);
}
