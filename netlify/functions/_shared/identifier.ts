const IDENT_RE = /^[a-z][a-z0-9_]{0,62}$/;
const SCHEMA_RE = /^client_[0-9a-f]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidIdentifier(s: string): boolean {
  return typeof s === 'string' && IDENT_RE.test(s);
}

export function isValidSchemaName(s: string): boolean {
  return typeof s === 'string' && SCHEMA_RE.test(s);
}

export function isValidUuid(s: string): boolean {
  return typeof s === 'string' && UUID_RE.test(s);
}

/**
 * Throws if `s` is not a valid UUID. The optional `field` hint is included
 * in the error message to make debugging easier (`invalid_uuid:clientId`
 * vs just `invalid_uuid`).
 */
export function assertUuid(s: string, field?: string): void {
  if (!isValidUuid(s)) {
    throw new Error(field ? `invalid_uuid:${field}` : 'invalid_uuid');
  }
}

export function safeQuoteIdent(s: string): string {
  if (!isValidIdentifier(s)) throw new Error(`invalid_identifier: ${JSON.stringify(s)}`);
  return `"${s}"`;
}

export function safeQuoteSchema(s: string): string {
  if (!isValidSchemaName(s)) throw new Error(`invalid_schema_name: ${JSON.stringify(s)}`);
  return `"${s}"`;
}

export function generateSchemaName(rand: () => string = defaultHex): string {
  return `client_${rand()}`;
}

function defaultHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
